import 'server-only';

/**
 * Server-side identity: the ACTA client, and the hub's own issuer.
 *
 * `server-only` because the issuer's secret key lives here. It signs credential
 * issuance, so it can spend the issuer account's XLM — it must never reach a
 * bundle, and it must never be prefixed `NEXT_PUBLIC_`.
 *
 * The issuer identity is configured, never minted on demand. A hub that created
 * a DID whenever it noticed it had none would mint a fresh one on every restart
 * and orphan every attestation it had signed under the last one. `pnpm
 * setup:identity` creates it once and prints the two values to set.
 *
 * Without those values the whole layer degrades to a labelled mock, the same
 * way the Etherfuse adapter does without its key. That is what lets CI run the
 * hub with no environment at all.
 */

import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { RampError, resolveMode, type AdapterMode } from '@brk/ramp-core';
import {
  createIdentityApi,
  type IdentityApi,
  type PreparedTx,
  isValidDid,
} from '@brk/identity-kit';

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export interface IdentityIssuer {
  publicKey: string;
  did: string;
}

export interface IdentityRegistry {
  api: IdentityApi;
  mode: AdapterMode;
  /** Null in mock mode, where nothing is signed and no account is needed. */
  issuer: IdentityIssuer;
  resolverUrl: string;
}

const REGISTRY_KEY = Symbol.for('brk.identity.registry.v1');
const scope = globalThis as unknown as Record<symbol, IdentityRegistry | undefined>;

/**
 * Mock unless we have everything live needs: a key for the credentials API, and
 * an issuer whose DID is already registered. Half a configuration produces a
 * confusing runtime failure at the first attestation; this produces a badge.
 */
export function identityMode(): AdapterMode {
  return resolveMode({
    adapterEnv: process.env.IDENTITY_MODE,
    globalEnv: process.env.RAMP_MODE,
    liveAvailable: Boolean(
      process.env.ACTA_API_KEY &&
      process.env.IDENTITY_ISSUER_SECRET &&
      process.env.IDENTITY_ISSUER_DID,
    ),
  });
}

/** Stand-in issuer for mock mode. Deliberately not a real account. */
const MOCK_ISSUER: IdentityIssuer = {
  publicKey: 'GMOCKISSUER0000000000000000000000000000000000000000000',
  did: 'did:stellar:testnet:mockissuerhubaaaaaaaaaaaa',
};

function build(): IdentityRegistry {
  const mode = identityMode();

  const issuer =
    mode === 'live'
      ? {
          publicKey: Keypair.fromSecret(process.env.IDENTITY_ISSUER_SECRET!).publicKey(),
          did: process.env.IDENTITY_ISSUER_DID!,
        }
      : MOCK_ISSUER;

  return {
    mode,
    issuer,
    resolverUrl: process.env.DID_RESOLVER_URL ?? 'https://did.acta.build',
    api: createIdentityApi({
      mode,
      apiKey: process.env.ACTA_API_KEY,
      actaUrl: process.env.ACTA_API_URL,
      resolverUrl: process.env.DID_RESOLVER_URL,
      network: 'testnet',
    }),
  };
}

export function identity(): IdentityRegistry {
  const existing = scope[REGISTRY_KEY];
  if (existing?.api && existing.issuer) return existing;
  const created = build();
  scope[REGISTRY_KEY] = created;
  return created;
}

/** Drop the cache so the next request rebuilds against changed env. */
export function resetIdentity(): void {
  scope[REGISTRY_KEY] = undefined;
}

/**
 * Sign a prepared transaction with the issuer key.
 *
 * Only issuance goes through here. DID registration is signed by the user's own
 * wallet, because the user is the controller — the hub never holds a key that
 * could mutate somebody else's identity.
 */
export async function signWithIssuer(prepared: PreparedTx): Promise<string> {
  const registry = identity();
  if (registry.mode === 'mock') return prepared.xdr;

  const secret = process.env.IDENTITY_ISSUER_SECRET;
  if (!secret) {
    throw new RampError({
      code: 'AUTH_FAILED',
      anchorId: 'acta',
      message: 'No issuer key configured — run `pnpm setup:identity`.',
    });
  }

  const tx = TransactionBuilder.fromXDR(
    prepared.xdr,
    prepared.networkPassphrase || TESTNET_PASSPHRASE,
  );
  tx.sign(Keypair.fromSecret(secret));
  return tx.toXDR();
}

/**
 * What we can honestly check about a transaction before a wallet signs it.
 *
 * The SEP-10 client in this kit verifies an anchor's challenge before handing
 * it to a wallet, and the same reflex applies here: a service that hands you a
 * transaction and asks for a signature is a service you should not trust
 * blindly, however friendly.
 *
 * What this DOES check: the transaction parses, it is for the network we
 * expect, its source is the account that asked, and the fee is not absurd.
 *
 * What it CANNOT check: what the Soroban invocation actually does. Verifying
 * that would mean reimplementing the registry contract's argument encoding, and
 * a wrong reimplementation would reject valid registrations while still not
 * proving much. The honest position is that the resolver is trusted for the
 * call's contents and verified for everything around them — and that the
 * controller can always undo a bad registration by simply not using the DID.
 */
export function assertSignableRegistration(prepared: PreparedTx, expectedSource: string): void {
  const fail = (message: string): never => {
    throw new RampError({ code: 'INVALID_REQUEST', anchorId: 'acta', message });
  };

  const passphrase = prepared.networkPassphrase || TESTNET_PASSPHRASE;
  if (passphrase !== TESTNET_PASSPHRASE) {
    fail(`Refusing to sign a transaction for "${passphrase}" — this hub is testnet only.`);
  }

  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(prepared.xdr, passphrase);
  } catch (cause) {
    return void fail(
      `The DID resolver returned something that is not a transaction: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }

  // A fee bump wraps the transaction that actually runs; the source that
  // matters is the inner one.
  const inner = 'innerTransaction' in tx ? tx.innerTransaction : tx;

  if (inner.source !== expectedSource) {
    fail(
      `The DID resolver built a transaction for ${inner.source}, not for the connected wallet ${expectedSource}.`,
    );
  }

  // 10 XLM. A registration costs a fraction of this; anything near it is either
  // a mistake or an attempt to drain the account through fees.
  const MAX_FEE_STROOPS = 100_000_000;
  if (Number(tx.fee) > MAX_FEE_STROOPS) {
    fail(`Refusing to sign a transaction with a ${Number(tx.fee) / 10_000_000} XLM fee.`);
  }
}

/** `G…` only: the registry's controller is a classic account in v0.1. */
export function assertControllerAddress(address: string | null | undefined): string {
  if (!address?.startsWith('G')) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      anchorId: 'acta',
      message: address?.startsWith('C')
        ? 'did:stellar needs a classic G… address. Passkey wallets expose a C… contract address — connect the underlying classic account instead.'
        : 'A classic Stellar address (G…) is required.',
    });
  }
  return address;
}

export function assertDid(did: string | null | undefined): string {
  if (!did || !isValidDid(did)) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      anchorId: 'acta',
      message: `Not a did:stellar: ${did ?? '(missing)'}`,
    });
  }
  return did;
}
