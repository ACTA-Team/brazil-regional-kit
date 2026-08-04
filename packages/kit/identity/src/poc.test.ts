/**
 * Proof of control.
 *
 * This is a login. Everything below is a way for someone who is not the DID
 * holder to get in, and the assertion that they cannot: a stale challenge, a
 * challenge minted for another site, a signature observed and replayed, a
 * signature from a key that is not in the document.
 *
 * Every test mints its own nonce and DID, because the nonce store is pinned to
 * the realm and a shared one would make the suite order-dependent.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { base64urlnopad } from '@scure/base';
import { walletKeyToMultikey } from './keys/stellar-key';
import {
  createPocChallenge,
  generateNonce,
  jcsCanonicalize,
  mockPocSignature,
  MOCK_SIGNATURE_PREFIX,
  POC_WINDOW_MS,
  pocMessageBytes,
  resetPocNonces,
  verifyPocResponse,
} from './poc';

const DOMAIN = 'brk.example';
const T0 = Date.parse('2026-02-01T12:00:00.000Z');

/** A distinct, *valid* DID per test — base32 has no 0, 1, 8 or 9 to count in. */
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
let counter = 0;
function freshDid(): string {
  let tail = '';
  for (let n = ++counter; n > 0; n = Math.floor(n / 32)) tail = BASE32[n % 32] + tail;
  return `did:stellar:testnet:${tail.padStart(26, 'a')}`;
}

const wallet = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 11));
const AUTH_KEY = walletKeyToMultikey(wallet.publicKey());

function signed(challenge: Parameters<typeof pocMessageBytes>[0]) {
  return base64urlnopad.encode(wallet.sign(Buffer.from(pocMessageBytes(challenge))));
}

function challengeAt(nowMs = T0, did = freshDid()) {
  return createPocChallenge({ did, domain: DOMAIN, now: () => nowMs });
}

beforeEach(resetPocNonces);

describe('jcsCanonicalize', () => {
  it('sorts keys, so both sides sign the same bytes', () => {
    // Without this the signature covers whatever order the signer's serializer
    // produced, and two parties who agree on every value still fail to verify.
    expect(jcsCanonicalize({ b: '2', a: '1' })).toBe('{"a":"1","b":"2"}');
    expect(jcsCanonicalize({ a: '1', b: '2' })).toBe(jcsCanonicalize({ b: '2', a: '1' }));
  });

  it('handles nested objects and arrays', () => {
    expect(jcsCanonicalize({ z: [{ b: 1, a: 2 }], a: null })).toBe(
      '{"a":null,"z":[{"a":2,"b":1}]}',
    );
  });

  it('escapes strings the way JSON does', () => {
    expect(jcsCanonicalize({ k: 'a"b\n' })).toBe('{"k":"a\\"b\\n"}');
  });

  it('emits scalars bare', () => {
    expect(jcsCanonicalize('x')).toBe('"x"');
    expect(jcsCanonicalize(42)).toBe('42');
    expect(jcsCanonicalize(true)).toBe('true');
    expect(jcsCanonicalize(null)).toBe('null');
  });

  it('drops undefined members rather than emitting a hole', () => {
    expect(jcsCanonicalize({ a: '1', b: undefined } as never)).toBe('{"a":"1"}');
  });
});

describe('createPocChallenge', () => {
  it('carries the DID, the domain, a nonce and a timestamp', () => {
    const challenge = challengeAt();
    expect(challenge).toMatchObject({ domain: DOMAIN, timestamp: '2026-02-01T12:00:00.000Z' });
    expect(challenge.nonce).toBeTruthy();
  });

  it('mints a different nonce every time', () => {
    const nonces = new Set(Array.from({ length: 20 }, generateNonce));
    expect(nonces.size).toBe(20);
  });

  it('refuses a DID it cannot parse', () => {
    expect(() => createPocChallenge({ did: 'did:key:x', domain: DOMAIN })).toThrowError(
      /Not a did:stellar/,
    );
  });

  it('refuses to issue a challenge with no domain', () => {
    // A challenge that names no site can be replayed at any site.
    expect(() => createPocChallenge({ did: freshDid(), domain: '' })).toThrowError(/domain/);
  });
});

describe('verifyPocResponse', () => {
  const verify = (
    challenge: ReturnType<typeof challengeAt>,
    signature: string,
    overrides: Partial<Parameters<typeof verifyPocResponse>[0]> = {},
  ) =>
    verifyPocResponse({
      challenge,
      signature,
      authentication: [AUTH_KEY],
      expectedDomain: DOMAIN,
      mode: 'live',
      now: () => T0 + 1_000,
      ...overrides,
    });

  it('accepts a signature from an authentication key', () => {
    const challenge = challengeAt();
    expect(verify(challenge, signed(challenge))).toEqual({
      verified: true,
      matchedKey: AUTH_KEY,
    });
  });

  it('finds the matching key when the document holds several', () => {
    const challenge = challengeAt();
    const other = walletKeyToMultikey(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 12)).publicKey());

    expect(
      verify(challenge, signed(challenge), { authentication: [other, AUTH_KEY] }),
    ).toMatchObject({ verified: true, matchedKey: AUTH_KEY });
  });

  it('skips a malformed key rather than letting it veto the others', () => {
    const challenge = challengeAt();
    expect(
      verify(challenge, signed(challenge), { authentication: ['not-a-key', AUTH_KEY] }),
    ).toMatchObject({ verified: true });
  });

  it('rejects a signature from a key that is not in the document', () => {
    const challenge = challengeAt();
    const impostor = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 99));
    const signature = base64urlnopad.encode(impostor.sign(Buffer.from(pocMessageBytes(challenge))));

    expect(verify(challenge, signature)).toEqual({ verified: false, reason: 'bad-signature' });
  });

  it('rejects a signature over a different challenge', () => {
    const signature = signed(challengeAt(T0));
    const challenge = challengeAt(T0);

    expect(verify(challenge, signature)).toEqual({ verified: false, reason: 'bad-signature' });
  });

  it('rejects a document with no authentication keys', () => {
    const challenge = challengeAt();
    expect(verify(challenge, signed(challenge), { authentication: [] })).toEqual({
      verified: false,
      reason: 'no-keys',
    });
  });

  it('rejects a signature it cannot decode', () => {
    const challenge = challengeAt();
    expect(verify(challenge, '!!! not base64 !!!')).toEqual({
      verified: false,
      reason: 'bad-signature',
    });
  });

  it('accepts standard base64 as well as base64url', () => {
    // Wallets differ. Rejecting a valid signature for its alphabet is a bug
    // that looks exactly like a wrong key.
    const challenge = challengeAt();
    const standard = Buffer.from(wallet.sign(Buffer.from(pocMessageBytes(challenge)))).toString(
      'base64',
    );

    expect(verify(challenge, standard)).toMatchObject({ verified: true });
  });

  describe('the checks that run before the cryptography', () => {
    it('rejects a challenge past the five-minute window', () => {
      const challenge = challengeAt();
      expect(verify(challenge, signed(challenge), { now: () => T0 + POC_WINDOW_MS + 1 })).toEqual({
        verified: false,
        reason: 'expired',
      });
    });

    it('accepts one at the very edge of the window', () => {
      const challenge = challengeAt();
      expect(verify(challenge, signed(challenge), { now: () => T0 + POC_WINDOW_MS })).toMatchObject(
        { verified: true },
      );
    });

    it('rejects a challenge timestamped in the future', () => {
      const challenge = challengeAt(T0 + 60_000);
      expect(verify(challenge, signed(challenge), { now: () => T0 })).toEqual({
        verified: false,
        reason: 'expired',
      });
    });

    it('rejects an unparseable timestamp', () => {
      const challenge = { ...challengeAt(), timestamp: 'whenever' };
      expect(verify(challenge, 'sig')).toEqual({ verified: false, reason: 'expired' });
    });

    it('rejects a challenge minted for another site', () => {
      const challenge = challengeAt();
      expect(verify(challenge, signed(challenge), { expectedDomain: 'evil.example' })).toEqual({
        verified: false,
        reason: 'domain-mismatch',
      });
    });

    it('rejects a DID the challenge should never have carried', () => {
      const challenge = { ...challengeAt(), did: 'did:key:x' };
      expect(verify(challenge, 'sig')).toEqual({ verified: false, reason: 'invalid-did' });
    });
  });

  describe('nonces', () => {
    it('rejects a second use of the same signature', () => {
      const challenge = challengeAt();
      const signature = signed(challenge);

      expect(verify(challenge, signature)).toMatchObject({ verified: true });
      expect(verify(challenge, signature)).toEqual({
        verified: false,
        reason: 'nonce-replayed',
      });
    });

    /*
     * Burned before the signature is checked, not after. A nonce that survives a
     * failed attempt lets an attacker retry a captured signature until something
     * changes, which is not single use.
     */
    it('burns the nonce even when verification fails', () => {
      const challenge = challengeAt();

      expect(verify(challenge, 'garbage')).toEqual({ verified: false, reason: 'bad-signature' });
      expect(verify(challenge, signed(challenge))).toEqual({
        verified: false,
        reason: 'nonce-replayed',
      });
    });

    it('rejects a nonce this verifier never issued', () => {
      const challenge = { ...challengeAt(), nonce: 'made-up' };
      expect(verify(challenge, 'sig')).toEqual({ verified: false, reason: 'nonce-replayed' });
    });

    it('sweeps expired nonces instead of growing forever', () => {
      const stale = challengeAt(T0);
      // A later challenge sweeps the store on its way in.
      challengeAt(T0 + POC_WINDOW_MS + 1);

      expect(verify(stale, signed(stale), { now: () => T0 + 1 })).toEqual({
        verified: false,
        reason: 'nonce-replayed',
      });
    });

    it('resetPocNonces clears the store', () => {
      const challenge = challengeAt();
      resetPocNonces();

      expect(verify(challenge, signed(challenge))).toEqual({
        verified: false,
        reason: 'nonce-replayed',
      });
    });
  });

  describe('mock mode', () => {
    it('accepts the documented deterministic stand-in', () => {
      const challenge = challengeAt();
      expect(verify(challenge, mockPocSignature(challenge), { mode: 'mock' })).toEqual({
        verified: true,
        matchedKey: 'mock',
      });
    });

    it('labels the stand-in so nothing can mistake it for a signature', () => {
      expect(mockPocSignature(challengeAt()).startsWith(MOCK_SIGNATURE_PREFIX)).toBe(true);
    });

    it('rejects anything else in mock mode', () => {
      const challenge = challengeAt();
      expect(verify(challenge, signed(challenge), { mode: 'mock' })).toEqual({
        verified: false,
        reason: 'bad-signature',
      });
    });

    it('rejects the mock stand-in in live mode', () => {
      // The prefix makes it undecodable as a signature, so it never reaches the
      // Ed25519 check — but the point is that live mode is not fooled by it.
      const challenge = challengeAt();
      expect(verify(challenge, mockPocSignature(challenge))).toEqual({
        verified: false,
        reason: 'bad-signature',
      });
    });

    it('still enforces the window and the nonce in mock mode', () => {
      const challenge = challengeAt();
      expect(
        verify(challenge, mockPocSignature(challenge), {
          mode: 'mock',
          now: () => T0 + POC_WINDOW_MS + 1,
        }),
      ).toEqual({ verified: false, reason: 'expired' });
    });
  });
});
