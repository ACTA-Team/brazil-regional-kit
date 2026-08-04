/**
 * The strkey ↔ multikey bridge.
 *
 * The claim these tests defend is that a `G…` address and a `z6Mk…` multikey are
 * the same 32 bytes wearing different clothes. If that stops being true, a DID
 * registered from a wallet stops being provable by that wallet, and proof of
 * control fails for reasons that look like a signing bug.
 */

import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { decodeMultikey } from '../did/did';
import {
  assertClassicAddress,
  multikeyToWalletKey,
  verifyWithMultikey,
  walletKeyToMultikey,
} from './stellar-key';

/** Deterministic, so a failure is reproducible rather than a coin flip. */
function keypairFrom(seedByte: number): Keypair {
  return Keypair.fromRawEd25519Seed(Buffer.alloc(32, seedByte));
}

const wallet = keypairFrom(7);

describe('assertClassicAddress', () => {
  it('accepts a classic account', () => {
    expect(() => assertClassicAddress(wallet.publicKey())).not.toThrow();
  });

  it('explains the passkey trap instead of just saying invalid', () => {
    // A `C…` looks like an address and is silently useless: the registry's
    // controller is a classic account, and a contract has no key to verify.
    expect(() =>
      assertClassicAddress('CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ'),
    ).toThrowError(/underlying classic account/);
  });

  it('rejects nonsense with the address in the message', () => {
    expect(() => assertClassicAddress('not-an-address')).toThrowError(/not-an-address/);
  });
});

describe('walletKeyToMultikey', () => {
  it('round-trips back to the same account', () => {
    const multikey = walletKeyToMultikey(wallet.publicKey());
    expect(multikeyToWalletKey(multikey)).toBe(wallet.publicKey());
  });

  it('carries exactly the account raw key bytes', () => {
    expect(decodeMultikey(walletKeyToMultikey(wallet.publicKey()))).toEqual(
      Uint8Array.from(wallet.rawPublicKey()),
    );
  });

  it('is stable — the same address always yields the same key', () => {
    expect(walletKeyToMultikey(wallet.publicKey())).toBe(walletKeyToMultikey(wallet.publicKey()));
  });

  it('yields different keys for different accounts', () => {
    expect(walletKeyToMultikey(wallet.publicKey())).not.toBe(
      walletKeyToMultikey(keypairFrom(8).publicKey()),
    );
  });
});

describe('verifyWithMultikey', () => {
  const message = new TextEncoder().encode('challenge to sign');
  const multikey = walletKeyToMultikey(wallet.publicKey());

  it('accepts a signature from the matching key', () => {
    const signature = wallet.sign(Buffer.from(message));
    expect(verifyWithMultikey(multikey, message, signature)).toBe(true);
  });

  it('rejects a signature over different bytes', () => {
    const signature = wallet.sign(Buffer.from(new TextEncoder().encode('something else')));
    expect(verifyWithMultikey(multikey, message, signature)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const signature = keypairFrom(8).sign(Buffer.from(message));
    expect(verifyWithMultikey(multikey, message, signature)).toBe(false);
  });

  it('returns false rather than throwing on a malformed signature', () => {
    // A wallet that returns a truncated or differently framed signature is a
    // failed verification, not a crash in the middle of a login flow.
    expect(verifyWithMultikey(multikey, message, new Uint8Array(7))).toBe(false);
  });

  it('still throws when the key material itself is wrong', () => {
    expect(() => verifyWithMultikey('not-a-multikey', message, new Uint8Array(64))).toThrowError(
      /base58btc/,
    );
  });
});
