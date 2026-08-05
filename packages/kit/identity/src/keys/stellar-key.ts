/**
 * The bridge between a Stellar account and a DID verification key.
 *
 * A classic `G…` address and a `z6Mk…` multikey are two encodings of the same
 * 32 raw Ed25519 bytes: strkey wraps them in a version byte and a CRC16, the
 * multikey in a multicodec prefix and base58btc. Because they are the same key
 * material, a DID whose authentication key came from the controller's wallet can
 * be proven with a wallet signature — no separate key to generate, store or lose.
 *
 * This is the only module in the package that needs `@stellar/stellar-sdk`, and
 * it needs it for exactly two things it would be reckless to reimplement: the
 * checksummed strkey codec, and Ed25519 verification.
 */

import { Keypair, StrKey, hash } from '@stellar/stellar-sdk';
import { RampError } from '@brk/ramp-core';
import { decodeMultikey, encodeMultikey } from '../did/did';

/**
 * Passkey wallets expose a `C…` contract address. It looks like an address and
 * is silently useless here: the registry's controller is a classic account
 * (`G…`) in v0.1, and a contract address has no Ed25519 key to verify against.
 */
export function assertClassicAddress(address: string): void {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: address?.startsWith('C')
        ? 'did:stellar needs a classic G… address as controller. Passkey wallets expose a C… contract address — pass the underlying classic account instead.'
        : `Not a valid Stellar public key: ${address}`,
    });
  }
}

/** `G…` → `z6Mk…`, ready to go into a DID record's `authentication`. */
export function walletKeyToMultikey(publicKey: string): string {
  assertClassicAddress(publicKey);
  return encodeMultikey(StrKey.decodeEd25519PublicKey(publicKey));
}

/** `z6Mk…` → `G…`, so a resolved document's key can be checked against a wallet. */
export function multikeyToWalletKey(multikey: string): string {
  return StrKey.encodeEd25519PublicKey(Buffer.from(decodeMultikey(multikey)));
}

/**
 * Verify a signature against a multikey from a resolved DID document.
 *
 * Returns false rather than throwing on a bad signature — a failed verification
 * is an answer, not an error. Malformed key material still throws, because that
 * means the document itself is wrong.
 */
export function verifyWithMultikey(
  multikey: string,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  const keypair = Keypair.fromPublicKey(multikeyToWalletKey(multikey));
  try {
    return keypair.verify(Buffer.from(message), Buffer.from(signature));
  } catch {
    // A signature of the wrong length makes the underlying library throw. That
    // is still just "this signature does not verify".
    return false;
  }
}

/**
 * SHA-256, from the SDK that is already here.
 *
 * SEP-53 hashes its payload before signing, and this module is the package's
 * single point of contact with `@stellar/stellar-sdk` — adding a hashing
 * dependency elsewhere would spread that surface for one function the SDK
 * already exports.
 */
export function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(hash(Buffer.from(bytes)));
}
