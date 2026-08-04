/**
 * did:stellar identifiers, and the one conversion that matters here.
 *
 * The method is ACTA's, registered in the W3C DID Extensions registry. Its state
 * lives in a Soroban registry contract, so a DID is valid if and only if it is
 * on-chain — nothing in this file talks to a server, it only builds and parses
 * the strings that do.
 *
 * Two properties of the method drive the code below:
 *
 *   - The 26-character `didId` is 16 RANDOM bytes, deliberately not derived from
 *     any Stellar account. That is what lets a DID survive key rotation and lets
 *     one wallet control several DIDs. We mint it ourselves rather than reading
 *     it back from the resolver, so nothing downstream depends on the prepare
 *     response echoing it.
 *   - The wallet appears only as the `controller` inside the on-chain record,
 *     never in the DID string.
 */

import { base32, base58 } from '@scure/base';
import { RampError } from '@brk/ramp-core';

export type DidNetwork = 'mainnet' | 'testnet';

/** The canonical validation regex from the method spec. Closed set, no aliases. */
export const DID_STELLAR_REGEX = /^did:stellar:(mainnet|testnet):([a-z2-7]{26})$/;

/** 16 bytes of entropy, base32-encoded, is 26 characters with the padding gone. */
export const DID_ID_BYTES = 16;
export const DID_ID_LENGTH = 26;

export interface ParsedDid {
  network: DidNetwork;
  /** The opaque 26-character identifier, without the `did:stellar:<network>:` prefix. */
  id: string;
}

export function parseDid(did: string): ParsedDid | null {
  const match = DID_STELLAR_REGEX.exec(did);
  if (!match) return null;
  const [, network, id] = match;
  return { network: network as DidNetwork, id: id as string };
}

export function isValidDid(did: string): boolean {
  return DID_STELLAR_REGEX.test(did);
}

export function isTestnetDid(did: string): boolean {
  return parseDid(did)?.network === 'testnet';
}

export function buildDid(network: DidNetwork, id: string): string {
  return `did:stellar:${network}:${id}`;
}

/**
 * RFC 4648 base32, lowercase, unpadded — the encoding the method mandates.
 *
 * `@scure/base` emits uppercase with `=` padding, which is the same alphabet
 * under a different presentation, so the transform is presentational only.
 */
export function encodeDidId(bytes: Uint8Array): string {
  return base32.encode(bytes).replace(/=+$/, '').toLowerCase();
}

/**
 * Mint a new identifier.
 *
 * Fails loudly rather than falling back to `Math.random`: an identifier that
 * looks random but is not would be silently guessable, and there is no way to
 * tell the two apart by looking at the string.
 */
export function generateDidId(): string {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: 'No secure random source available — cannot mint a did:stellar identifier.',
    });
  }
  return encodeDidId(crypto.getRandomValues(new Uint8Array(DID_ID_BYTES)));
}

// ── Multikey ──────────────────────────────────────────────────────────────────

/**
 * The multicodec prefix for an Ed25519 public key, as an unsigned varint: `0xed
 * 0x01`. Prepended to the 32 raw key bytes, base58btc-encoded, and given the
 * multibase `z` prefix, it produces the `z6Mk…` strings the registry stores.
 */
const ED25519_MULTICODEC = Uint8Array.from([0xed, 0x01]);
const RAW_ED25519_LENGTH = 32;

export function encodeMultikey(rawPublicKey: Uint8Array): string {
  if (rawPublicKey.length !== RAW_ED25519_LENGTH) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: `Ed25519 public keys are ${RAW_ED25519_LENGTH} bytes, got ${rawPublicKey.length}.`,
    });
  }
  const prefixed = new Uint8Array(ED25519_MULTICODEC.length + rawPublicKey.length);
  prefixed.set(ED25519_MULTICODEC, 0);
  prefixed.set(rawPublicKey, ED25519_MULTICODEC.length);
  return `z${base58.encode(prefixed)}`;
}

export function decodeMultikey(multikey: string): Uint8Array {
  if (!multikey.startsWith('z')) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: `Unsupported multibase prefix in "${multikey}" — did:stellar keys are base58btc (z…).`,
    });
  }

  let decoded: Uint8Array;
  try {
    decoded = base58.decode(multikey.slice(1));
  } catch (cause) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: `Malformed multikey: ${multikey}`,
      cause,
    });
  }

  if (
    decoded.length !== ED25519_MULTICODEC.length + RAW_ED25519_LENGTH ||
    decoded[0] !== ED25519_MULTICODEC[0] ||
    decoded[1] !== ED25519_MULTICODEC[1]
  ) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: `Multikey ${multikey} is not an Ed25519 key — did:stellar authentication keys must be.`,
    });
  }

  return decoded.slice(ED25519_MULTICODEC.length);
}
