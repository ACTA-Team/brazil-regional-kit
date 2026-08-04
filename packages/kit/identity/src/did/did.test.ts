import { describe, expect, it } from 'vitest';
import { base58 } from '@scure/base';
import {
  buildDid,
  decodeMultikey,
  DID_ID_LENGTH,
  DID_STELLAR_REGEX,
  encodeDidId,
  encodeMultikey,
  generateDidId,
  isTestnetDid,
  isValidDid,
  parseDid,
} from './did';

/**
 * A real, permanently resolvable testnet DID from the method's own
 * documentation. Using the published example rather than one we invented means
 * the regex is checked against the thing it has to accept in production.
 */
const REAL_DID = 'did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi';

describe('parseDid', () => {
  it('accepts the documented testnet example', () => {
    expect(parseDid(REAL_DID)).toEqual({
      network: 'testnet',
      id: 'znfxngsh46vkyqu6inrx4omphi',
    });
  });

  it('accepts mainnet', () => {
    expect(parseDid('did:stellar:mainnet:znfxngsh46vkyqu6inrx4omphi')?.network).toBe('mainnet');
  });

  it.each([
    ['a different method', 'did:key:znfxngsh46vkyqu6inrx4omphi'],
    ['a network alias', 'did:stellar:test:znfxngsh46vkyqu6inrx4omphi'],
    ['no network', 'did:stellar:znfxngsh46vkyqu6inrx4omphi'],
    ['one character short', 'did:stellar:testnet:znfxngsh46vkyqu6inrx4omph'],
    ['one character long', 'did:stellar:testnet:znfxngsh46vkyqu6inrx4omphix'],
    ['uppercase', 'did:stellar:testnet:ZNFXNGSH46VKYQU6INRX4OMPHI'],
    ['trailing whitespace', `${REAL_DID} `],
    ['nothing at all', ''],
  ])('rejects %s', (_label, did) => {
    expect(parseDid(did)).toBeNull();
    expect(isValidDid(did)).toBe(false);
  });

  /*
   * base32 drops the four characters that are easy to misread — 0/O and 1/I/L.
   * A DID carrying one of them is not a typo to be corrected, it is invalid.
   */
  it.each(['0', '1', '8', '9'])('rejects the non-base32 character %s', (char) => {
    expect(isValidDid(`did:stellar:testnet:${char}nfxngsh46vkyqu6inrx4omph`)).toBe(false);
  });

  it('reports the network', () => {
    expect(isTestnetDid(REAL_DID)).toBe(true);
    expect(isTestnetDid('did:stellar:mainnet:znfxngsh46vkyqu6inrx4omphi')).toBe(false);
    expect(isTestnetDid('not a did')).toBe(false);
  });

  it('round-trips through buildDid', () => {
    const parsed = parseDid(REAL_DID);
    expect(buildDid(parsed!.network, parsed!.id)).toBe(REAL_DID);
  });
});

describe('generateDidId', () => {
  it('produces an identifier the regex accepts', () => {
    const id = generateDidId();
    expect(id).toHaveLength(DID_ID_LENGTH);
    expect(DID_STELLAR_REGEX.test(buildDid('testnet', id))).toBe(true);
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 50 }, generateDidId));
    expect(ids.size).toBe(50);
  });

  it('encodes 16 bytes as 26 unpadded lowercase characters', () => {
    const encoded = encodeDidId(new Uint8Array(16));
    expect(encoded).toBe('a'.repeat(26));
    expect(encoded).not.toContain('=');
  });
});

describe('multikey', () => {
  const raw = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

  it('round-trips a 32-byte Ed25519 key', () => {
    const multikey = encodeMultikey(raw);
    expect(multikey.startsWith('z6Mk')).toBe(true);
    expect(decodeMultikey(multikey)).toEqual(raw);
  });

  it('always produces the z6Mk prefix', () => {
    // The multicodec bytes are constant, so every Ed25519 multikey shares the
    // prefix. A key that does not start with it is a different curve.
    expect(encodeMultikey(new Uint8Array(32)).startsWith('z6Mk')).toBe(true);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => encodeMultikey(new Uint8Array(31))).toThrowError(/32 bytes, got 31/);
  });

  it('rejects a non-base58btc multibase prefix', () => {
    expect(() => decodeMultikey('u6MkwBw2szL21i4Ym1wqzV8bPWwJyp1WDt8oRofTEs9ZntSq')).toThrowError(
      /base58btc/,
    );
  });

  it('rejects malformed base58', () => {
    expect(() => decodeMultikey('z0OIl')).toThrowError(/Malformed multikey/);
  });

  it('rejects an X25519 key where an Ed25519 key is required', () => {
    // Same encoding, different multicodec prefix (0xec 0x01). Accepting it would
    // put a key-agreement key where a signature is expected.
    const x25519 = new Uint8Array(34);
    x25519[0] = 0xec;
    x25519[1] = 0x01;
    expect(() => decodeMultikey(`z${base58.encode(x25519)}`)).toThrowError(/not an Ed25519 key/);
  });

  it('rejects a correctly prefixed key of the wrong size', () => {
    const short = new Uint8Array(20);
    short[0] = 0xed;
    short[1] = 0x01;
    expect(() => decodeMultikey(`z${base58.encode(short)}`)).toThrowError(/not an Ed25519 key/);
  });
});
