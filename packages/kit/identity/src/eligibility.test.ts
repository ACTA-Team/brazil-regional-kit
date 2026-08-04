/**
 * Eligibility annotation.
 *
 * Two properties matter more than any individual status:
 *
 *   - **It never rejects.** Whatever identity does, the caller still gets its
 *     quotes back. A test here failing means an ACTA outage can take the price
 *     table down with it.
 *   - **It asks once per anchor, not once per quote, and caches.** The router
 *     page re-quotes every fifteen seconds and an open-ended route returns
 *     several quotes per anchor; without both, one page view becomes dozens of
 *     credential checks and the upstream rate limit does the rest.
 *
 * Every test uses its own DID so the realm-pinned cache cannot leak between them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentityApi, VcStatus } from './api/api';
import {
  annotateEligibility,
  DEFAULT_ELIGIBILITY_TTL_MS,
  resetEligibilityCache,
} from './eligibility';

const ISSUER = 'GISSUERWALLET';

/** A distinct, *valid* DID per test — base32 has no 0, 1, 8 or 9 to count in. */
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
let counter = 0;
function freshDid(): string {
  let tail = '';
  for (let n = ++counter; n > 0; n = Math.floor(n / 32)) tail = BASE32[n % 32] + tail;
  return `did:stellar:testnet:${tail.padStart(26, 'a')}`;
}

function apiReturning(status: VcStatus, mode: 'live' | 'mock' = 'live') {
  const verifyVc = vi.fn(async () => ({ status }));
  return { api: { mode, verifyVc } as unknown as IdentityApi, verifyVc };
}

const QUOTES = [
  { anchorId: 'etherfuse', buyAmount: '100' },
  { anchorId: 'testanchor', buyAmount: '99' },
];

const ANCHORS = [
  { anchorId: 'etherfuse', requiresOnboarding: true },
  { anchorId: 'testanchor', requiresOnboarding: false },
];

const annotate = (opts: Partial<Parameters<typeof annotateEligibility>[1]> = {}) =>
  annotateEligibility(QUOTES, {
    api: apiReturning('valid').api,
    issuerPublicKey: ISSUER,
    anchors: ANCHORS,
    did: freshDid(),
    ...opts,
  });

beforeEach(resetEligibilityCache);

describe('statuses', () => {
  it('marks an anchor with a valid attestation eligible', async () => {
    const { api } = apiReturning('valid');
    const [etherfuse] = await annotate({ api });

    expect(etherfuse!.eligibility).toMatchObject({
      status: 'eligible',
      mode: 'live',
      vcId: expect.stringContaining('att-etherfuse-'),
    });
  });

  it('marks an anchor with no attestation as needing onboarding', async () => {
    const { api } = apiReturning('unknown');
    const [etherfuse] = await annotate({ api });

    expect(etherfuse!.eligibility.status).toBe('needs-onboarding');
    expect(etherfuse!.eligibility.reason).toBeUndefined();
  });

  it('distinguishes a revoked attestation from one that never existed', async () => {
    // "You were onboarded and no longer are" is a different conversation from
    // "you have not onboarded yet", and the user deserves to be told which.
    const { api } = apiReturning('revoked');
    const [etherfuse] = await annotate({ api });

    expect(etherfuse!.eligibility).toMatchObject({
      status: 'needs-onboarding',
      reason: 'revoked',
    });
  });

  it('treats an invalid credential as needing onboarding', async () => {
    const { api } = apiReturning('invalid');
    const [etherfuse] = await annotate({ api });

    expect(etherfuse!.eligibility.status).toBe('needs-onboarding');
  });

  it('never checks an anchor that does not gate on onboarding', async () => {
    const { api, verifyVc } = apiReturning('valid');
    const [, testanchor] = await annotate({ api });

    expect(testanchor!.eligibility.status).toBe('not-required');
    // One call, for Etherfuse only.
    expect(verifyVc).toHaveBeenCalledTimes(1);
  });

  it('says no-did rather than guessing when the user has no DID', async () => {
    const { api, verifyVc } = apiReturning('valid');
    const [etherfuse, testanchor] = await annotate({ api, did: undefined });

    expect(etherfuse!.eligibility.status).toBe('no-did');
    // Still an honest answer for the ungated anchor.
    expect(testanchor!.eligibility.status).toBe('not-required');
    expect(verifyVc).not.toHaveBeenCalled();
  });

  it('treats a malformed DID as no DID instead of asking about it', async () => {
    const { api, verifyVc } = apiReturning('valid');
    const [etherfuse] = await annotate({ api, did: 'did:key:whatever' });

    expect(etherfuse!.eligibility.status).toBe('no-did');
    expect(verifyVc).not.toHaveBeenCalled();
  });

  it('carries the mode, so a mocked answer can be badged as one', async () => {
    const { api } = apiReturning('valid', 'mock');
    const [etherfuse] = await annotate({ api });

    expect(etherfuse!.eligibility.mode).toBe('mock');
  });

  it('stamps when the answer was obtained', async () => {
    const [etherfuse] = await annotate({ now: () => Date.parse('2026-02-01T00:00:00.000Z') });
    expect(etherfuse!.eligibility.checkedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('checks an anchor it was told nothing about, rather than assuming it is open', async () => {
    const { api, verifyVc } = apiReturning('valid');
    const annotated = await annotateEligibility([{ anchorId: 'mystery' }], {
      api,
      issuerPublicKey: ISSUER,
      anchors: [],
      did: freshDid(),
    });

    expect(annotated[0]!.eligibility.status).toBe('eligible');
    expect(verifyVc).toHaveBeenCalledTimes(1);
  });
});

describe('degradation', () => {
  it('reports unknown instead of throwing when the check fails', async () => {
    const api = {
      mode: 'live',
      verifyVc: async () => {
        throw new Error('ACTA is down');
      },
    } as unknown as IdentityApi;

    const [etherfuse] = await annotate({ api });
    expect(etherfuse!.eligibility).toMatchObject({
      status: 'unknown',
      reason: 'check-failed',
    });
  });

  it('still annotates the other anchors when one fails', async () => {
    const api = {
      mode: 'live',
      verifyVc: async ({ vcId }: { vcId: string }) => {
        if (vcId.includes('etherfuse')) throw new Error('down');
        return { status: 'valid' as const };
      },
    } as unknown as IdentityApi;

    const annotated = await annotateEligibility(
      [{ anchorId: 'etherfuse' }, { anchorId: 'anclap' }],
      {
        api,
        issuerPublicKey: ISSUER,
        anchors: [
          { anchorId: 'etherfuse', requiresOnboarding: true },
          { anchorId: 'anclap', requiresOnboarding: true },
        ],
        did: freshDid(),
      },
    );

    expect(annotated[0]!.eligibility.status).toBe('unknown');
    expect(annotated[1]!.eligibility.status).toBe('eligible');
  });

  it('does not cache a failure, so recovery is immediate', async () => {
    let fail = true;
    const verifyVc = vi.fn(async () => {
      if (fail) throw new Error('down');
      return { status: 'valid' as const };
    });
    const api = { mode: 'live', verifyVc } as unknown as IdentityApi;
    const did = freshDid();

    expect((await annotate({ api, did }))[0]!.eligibility.status).toBe('unknown');
    fail = false;
    expect((await annotate({ api, did }))[0]!.eligibility.status).toBe('eligible');
  });

  it('returns every quote untouched apart from the annotation', async () => {
    const annotated = await annotate();
    expect(annotated).toHaveLength(2);
    expect(annotated[0]).toMatchObject({ anchorId: 'etherfuse', buyAmount: '100' });
  });

  it('handles an empty quote list without calling anything', async () => {
    const { api, verifyVc } = apiReturning('valid');
    await expect(
      annotateEligibility([], { api, issuerPublicKey: ISSUER, anchors: ANCHORS, did: freshDid() }),
    ).resolves.toEqual([]);
    expect(verifyVc).not.toHaveBeenCalled();
  });
});

describe('caching', () => {
  it('asks once per anchor even when it quotes several destination assets', async () => {
    // An open-ended route asks one anchor about several assets. Onboarding
    // cannot differ between them, so neither can the answer.
    const { api, verifyVc } = apiReturning('valid');
    await annotateEligibility(
      [{ anchorId: 'etherfuse' }, { anchorId: 'etherfuse' }, { anchorId: 'etherfuse' }],
      {
        api,
        issuerPublicKey: ISSUER,
        anchors: [{ anchorId: 'etherfuse', requiresOnboarding: true }],
        did: freshDid(),
      },
    );

    expect(verifyVc).toHaveBeenCalledTimes(1);
  });

  it('reuses the answer inside the TTL', async () => {
    const { api, verifyVc } = apiReturning('valid');
    const did = freshDid();
    const at = (ms: number) => () => ms;

    await annotate({ api, did, now: at(1_000) });
    await annotate({ api, did, now: at(1_000 + DEFAULT_ELIGIBILITY_TTL_MS - 1) });

    expect(verifyVc).toHaveBeenCalledTimes(1);
  });

  it('asks again once the TTL is past', async () => {
    const { api, verifyVc } = apiReturning('valid');
    const did = freshDid();
    const at = (ms: number) => () => ms;

    await annotate({ api, did, now: at(1_000) });
    await annotate({ api, did, now: at(1_000 + DEFAULT_ELIGIBILITY_TTL_MS + 1) });

    expect(verifyVc).toHaveBeenCalledTimes(2);
  });

  it('honours a custom TTL', async () => {
    const { api, verifyVc } = apiReturning('valid');
    const did = freshDid();

    await annotate({ api, did, ttlMs: 10, now: () => 1_000 });
    await annotate({ api, did, ttlMs: 10, now: () => 1_020 });

    expect(verifyVc).toHaveBeenCalledTimes(2);
  });

  it('does not serve one DID`s answer to another', async () => {
    const { api, verifyVc } = apiReturning('valid');
    await annotate({ api, did: freshDid() });
    await annotate({ api, did: freshDid() });

    expect(verifyVc).toHaveBeenCalledTimes(2);
  });

  /*
   * Mode is part of the cache key. Without it, adding an API key and restarting
   * in live mode would serve the mock's answers until the TTL expired — the
   * exact moment you most want the real one.
   */
  it('does not serve a mocked answer to a live client', async () => {
    const did = freshDid();
    const mock = apiReturning('valid', 'mock');
    const live = apiReturning('unknown', 'live');

    await annotate({ api: mock.api, did });
    const [etherfuse] = await annotate({ api: live.api, did });

    expect(etherfuse!.eligibility.status).toBe('needs-onboarding');
    expect(live.verifyVc).toHaveBeenCalledTimes(1);
  });

  it('resetEligibilityCache forces a fresh check', async () => {
    const { api, verifyVc } = apiReturning('valid');
    const did = freshDid();

    await annotate({ api, did, now: () => 1_000 });
    resetEligibilityCache();
    await annotate({ api, did, now: () => 1_000 });

    expect(verifyVc).toHaveBeenCalledTimes(2);
  });
});
