/**
 * Which of these quotes can the user actually execute?
 *
 * The router answers "who has the best price". It cannot answer "and can I take
 * it", because onboarding is per anchor and the router deliberately knows
 * nothing about identity. So the annotation happens here, on the way out, and
 * the router's public API is untouched: an app that never imports this package
 * gets exactly the behaviour it got before.
 *
 * The rule this file exists to enforce: **identity must never break quoting.**
 * A down resolver, an expired API key, a rate limit — any of them degrade a
 * quote to `unknown`, which the UI renders as no chip at all. `annotateEligibility`
 * does not reject. Prices are the product; this is a hint on top of them.
 */

import type { IdentityApi, IdentityMode } from './api/api';
import { attestationVcId } from './attestation';
import { isValidDid } from './did/did';

export type EligibilityStatus =
  /** A valid attestation exists: the user has onboarded with this anchor. */
  | 'eligible'
  /** No attestation, or one that has been revoked. The user must onboard first. */
  | 'needs-onboarding'
  /** The anchor does not gate execution on onboarding — nothing to check. */
  | 'not-required'
  /** No DID was supplied, so there is nothing to check it against. */
  | 'no-did'
  /** We asked and could not get an answer. Says nothing about the user. */
  | 'unknown';

export interface AnchorEligibility {
  status: EligibilityStatus;
  /** Carried so the UI can badge a mocked answer rather than imply it is real. */
  mode: IdentityMode;
  /** The derived credential id that was checked, when one was. */
  vcId?: string;
  reason?: 'revoked' | 'check-failed';
  checkedAt: string;
}

/**
 * What the caller knows about each anchor. The hub derives `requiresOnboarding`
 * from `AdapterCapabilities.features.orders`: an anchor that only quotes — an
 * unauthenticated SEP-38 price server, say — has no order to gate.
 */
export interface EligibilityInput {
  anchorId: string;
  requiresOnboarding: boolean;
}

export interface AnnotateEligibilityOptions {
  api: IdentityApi;
  /** The vault holding attestations: the issuer's own wallet. */
  issuerPublicKey: string;
  anchors: EligibilityInput[];
  /** Absent when the user has no DID yet — a normal state, not an error. */
  did?: string;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Sixty seconds.
 *
 * The router page re-quotes every fifteen. Re-verifying every credential on
 * every refresh would quadruple the traffic to ACTA for an answer that changes
 * when the user completes an onboarding — minutes apart, not seconds. It also
 * keeps a page full of anchors comfortably inside the resolver's 120-per-minute
 * budget.
 */
export const DEFAULT_ELIGIBILITY_TTL_MS = 60_000;

interface CacheEntry {
  eligibility: AnchorEligibility;
  expiresAtMs: number;
}

const CACHE_KEY = Symbol.for('brk.identity.eligibility.v1');
const scope = globalThis as unknown as Record<symbol, Map<string, CacheEntry> | undefined>;

function cache(): Map<string, CacheEntry> {
  return (scope[CACHE_KEY] ??= new Map());
}

export function resetEligibilityCache(): void {
  scope[CACHE_KEY] = undefined;
}

/** Mode is part of the key: switching to live must not serve a mocked answer. */
function cacheKey(mode: IdentityMode, did: string, anchorId: string): string {
  return `${mode}|${did}|${anchorId}`;
}

async function checkAnchor(
  anchorId: string,
  did: string,
  opts: AnnotateEligibilityOptions,
  nowMs: number,
): Promise<AnchorEligibility> {
  const { api, issuerPublicKey, ttlMs = DEFAULT_ELIGIBILITY_TTL_MS } = opts;
  const key = cacheKey(api.mode, did, anchorId);

  const cached = cache().get(key);
  if (cached && cached.expiresAtMs > nowMs) return cached.eligibility;

  const checkedAt = new Date(nowMs).toISOString();
  let eligibility: AnchorEligibility;

  try {
    const vcId = attestationVcId(did, anchorId);
    const { status } = await api.verifyVc({ owner: issuerPublicKey, vcId });

    eligibility =
      status === 'valid'
        ? { status: 'eligible', mode: api.mode, vcId, checkedAt }
        : {
            status: 'needs-onboarding',
            mode: api.mode,
            vcId,
            // A revoked attestation is not the same as never having had one, and
            // the user deserves to be told which of the two happened.
            reason: status === 'revoked' ? 'revoked' : undefined,
            checkedAt,
          };
  } catch {
    // Deliberately swallowed. The alternative is an identity outage taking the
    // price table with it, and the price table is the product.
    return { status: 'unknown', mode: api.mode, reason: 'check-failed', checkedAt };
  }

  cache().set(key, { eligibility, expiresAtMs: nowMs + ttlMs });
  return eligibility;
}

export async function annotateEligibility<Q extends { anchorId: string }>(
  quotes: Q[],
  opts: AnnotateEligibilityOptions,
): Promise<Array<Q & { eligibility: AnchorEligibility }>> {
  const nowMs = opts.now?.() ?? Date.now();
  const checkedAt = new Date(nowMs).toISOString();
  const mode = opts.api.mode;

  const gated = new Map(opts.anchors.map((a) => [a.anchorId, a.requiresOnboarding]));
  const hasDid = Boolean(opts.did && isValidDid(opts.did));

  // One check per anchor, not per quote: an open-ended route asks the same
  // anchor about several destination assets and the answer cannot differ.
  const results = new Map<string, AnchorEligibility>();
  const relevant = [...new Set(quotes.map((q) => q.anchorId))].filter(
    (anchorId) => gated.get(anchorId) !== false,
  );

  if (hasDid) {
    await Promise.all(
      relevant.map(async (anchorId) => {
        results.set(anchorId, await checkAnchor(anchorId, opts.did!, opts, nowMs));
      }),
    );
  }

  return quotes.map((quote) => {
    const requiresOnboarding = gated.get(quote.anchorId) !== false;

    const eligibility: AnchorEligibility = !requiresOnboarding
      ? { status: 'not-required', mode, checkedAt }
      : !hasDid
        ? { status: 'no-did', mode, checkedAt }
        : (results.get(quote.anchorId) ?? { status: 'unknown', mode, checkedAt });

    return { ...quote, eligibility };
  });
}
