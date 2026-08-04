/**
 * Proof of Control — logging in as a DID, with no transaction and no password.
 *
 * The verifier issues a challenge, the holder signs it with an `authentication`
 * key from their DID document, the verifier checks the signature against the
 * document it resolves itself. Nothing is stored, nothing is spent, and the
 * server never sees a key.
 *
 * The checks run in the order the method specifies, and the order is the point:
 *
 *   1. **Freshness** — a five-minute window, so a captured challenge dies quickly.
 *   2. **Domain** — the challenge names the site it is for, so a signature
 *      collected by another site cannot be replayed here.
 *   3. **Nonce** — single use, burned on the first verification, so a signature
 *      observed in flight cannot be used twice inside the window.
 *   4. **Signature** — last, because the three cheap checks above eliminate the
 *      cases where verifying the cryptography would tell you nothing.
 */

import { base64urlnopad } from '@scure/base';
import { RampError } from '@brk/ramp-core';
import type { IdentityMode } from './api/api';
import { isValidDid } from './did/did';
import { verifyWithMultikey } from './keys/stellar-key';

/** The method's window. Long enough for a user to read a wallet prompt. */
export const POC_WINDOW_MS = 5 * 60_000;

export interface PocChallenge {
  did: string;
  domain: string;
  nonce: string;
  /** ISO-8601. The window is measured from here. */
  timestamp: string;
}

const NONCE_BYTES = 16;

export function generateNonce(): string {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: 'No secure random source available — cannot issue a proof-of-control challenge.',
    });
  }
  return base64urlnopad.encode(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

// ── JCS (RFC 8785) ────────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Canonical JSON, so both sides sign the same bytes.
 *
 * Without it the signature covers whatever key order the signer's JSON
 * serializer happened to produce, and verification fails for two parties who
 * agree on every value. Keys sort by UTF-16 code unit, which is what
 * `Array.prototype.sort` already does for strings and what RFC 8785 requires.
 *
 * Scalars go through `JSON.stringify`, which matches the RFC for strings,
 * booleans, null and the integer range this kit uses. Exotic floating point is
 * the one place the two can differ — the challenge is four strings, so it never
 * arises here.
 */
export function jcsCanonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcsCanonicalize).join(',')}]`;

  const entries = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${jcsCanonicalize(value[key] as JsonValue)}`);

  return `{${entries.join(',')}}`;
}

export function pocMessageBytes(challenge: PocChallenge): Uint8Array {
  return new TextEncoder().encode(jcsCanonicalize({ ...challenge }));
}

// ── Nonce store ───────────────────────────────────────────────────────────────

const NONCE_KEY = Symbol.for('brk.identity.nonces.v1');
const scope = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;

function nonces(): Map<string, number> {
  return (scope[NONCE_KEY] ??= new Map());
}

export function resetPocNonces(): void {
  scope[NONCE_KEY] = undefined;
}

/*
 * A nonce must live exactly as long as the challenge carrying it is accepted,
 * and the window check below is inclusive of its final millisecond. Making this
 * one exclusive instead would reject a challenge that arrives on the boundary
 * as a replay — the same signature failing for two different stated reasons
 * depending on a millisecond.
 */
function isExpired(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs < nowMs;
}

/** Drop nonces past the window, so the store cannot grow without bound. */
function sweep(nowMs: number): void {
  for (const [nonce, expiresAtMs] of nonces()) {
    if (isExpired(expiresAtMs, nowMs)) nonces().delete(nonce);
  }
}

// ── Challenge ─────────────────────────────────────────────────────────────────

export interface CreateChallengeRequest {
  did: string;
  /** The site asking. Checked at verification, so it cannot be a placeholder. */
  domain: string;
  nonce?: string;
  now?: () => number;
}

export function createPocChallenge(req: CreateChallengeRequest): PocChallenge {
  if (!isValidDid(req.did)) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: `Not a did:stellar: ${req.did}`,
    });
  }
  if (!req.domain) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: 'A proof-of-control challenge must name the domain asking for it.',
    });
  }

  const nowMs = req.now?.() ?? Date.now();
  sweep(nowMs);

  const nonce = req.nonce ?? generateNonce();
  nonces().set(nonce, nowMs + POC_WINDOW_MS);

  return { did: req.did, domain: req.domain, nonce, timestamp: new Date(nowMs).toISOString() };
}

// ── Mock signing ──────────────────────────────────────────────────────────────

/**
 * Mock mode has no wallet, so it has no signature. This is a deterministic
 * restatement of the challenge, not a signature, and it is prefixed so nothing
 * can mistake it for one — a live verification rejects it like any other bad
 * signature, because it never reaches the Ed25519 check.
 */
export const MOCK_SIGNATURE_PREFIX = 'mock-poc:';

export function mockPocSignature(challenge: PocChallenge): string {
  return `${MOCK_SIGNATURE_PREFIX}${base64urlnopad.encode(pocMessageBytes(challenge))}`;
}

// ── Verification ──────────────────────────────────────────────────────────────

export type PocFailure =
  'invalid-did' | 'expired' | 'domain-mismatch' | 'nonce-replayed' | 'no-keys' | 'bad-signature';

export interface VerifyPocRequest {
  challenge: PocChallenge;
  /** base64url, padded or not. Wallets differ; both are accepted. */
  signature: string;
  /** `authentication` keys from the DID document the verifier resolved itself. */
  authentication: string[];
  /**
   * The domain the verifier is. Required, and deliberately not defaulted to the
   * challenge's own field: comparing a value to itself is a check that always
   * passes, which is worse than no check because it looks like one.
   */
  expectedDomain: string;
  mode: IdentityMode;
  now?: () => number;
}

export interface PocResult {
  verified: boolean;
  reason?: PocFailure;
  /** Which authentication key matched, when one did. */
  matchedKey?: string;
}

/**
 * Accept both base64url and standard base64, with or without padding.
 *
 * Wallets are not consistent about this, and rejecting a valid signature
 * because it arrived in the other alphabet is a bug that looks exactly like a
 * wrong key.
 */
function decodeSignature(signature: string): Uint8Array | null {
  const normalized = signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    return base64urlnopad.decode(normalized);
  } catch {
    return null;
  }
}

export function verifyPocResponse(req: VerifyPocRequest): PocResult {
  const { challenge } = req;
  const nowMs = req.now?.() ?? Date.now();

  if (!isValidDid(challenge.did)) return { verified: false, reason: 'invalid-did' };

  const issuedAtMs = Date.parse(challenge.timestamp);
  if (Number.isNaN(issuedAtMs) || nowMs - issuedAtMs > POC_WINDOW_MS || issuedAtMs > nowMs) {
    return { verified: false, reason: 'expired' };
  }

  if (challenge.domain !== req.expectedDomain) {
    return { verified: false, reason: 'domain-mismatch' };
  }

  /*
   * Burn the nonce before checking the signature, not after. Checking first
   * would let an attacker retry a captured signature until something changes,
   * and a nonce that survives a failed attempt is not single-use.
   */
  const expiresAtMs = nonces().get(challenge.nonce);
  if (expiresAtMs === undefined || isExpired(expiresAtMs, nowMs)) {
    return { verified: false, reason: 'nonce-replayed' };
  }
  nonces().delete(challenge.nonce);

  if (req.mode === 'mock') {
    return mockPocSignature(challenge) === req.signature
      ? { verified: true, matchedKey: 'mock' }
      : { verified: false, reason: 'bad-signature' };
  }

  if (req.authentication.length === 0) return { verified: false, reason: 'no-keys' };

  const signature = decodeSignature(req.signature);
  if (!signature) return { verified: false, reason: 'bad-signature' };

  const message = pocMessageBytes(challenge);
  // The method says to check every authentication key: a document may hold up
  // to three, and any of them proves control.
  for (const key of req.authentication) {
    try {
      if (verifyWithMultikey(key, message, signature)) {
        return { verified: true, matchedKey: key };
      }
    } catch {
      // A key we cannot decode is a key that cannot have signed this. Skip it
      // and keep going: one malformed entry must not veto the other two.
    }
  }
  return { verified: false, reason: 'bad-signature' };
}
