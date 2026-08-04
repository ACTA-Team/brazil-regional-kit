/**
 * x402 — HTTP 402 Payment Required, settled on Stellar.
 *
 * The shape is the whole idea: a client requests a resource, the server answers
 * `402` with machine-readable payment terms, the client pays and retries with
 * proof, and the server serves the resource. No accounts, no API keys, no
 * subscription — one HTTP round trip and a stablecoin payment that settles in
 * about five seconds.
 *
 * Why it belongs in a *regional* stablecoin kit: an agent paying for a Brazilian
 * FX rate should be able to pay in a Brazilian asset. The guard below is asset
 * agnostic, so the same three lines price an endpoint in USDC, TESOURO or any
 * regional stablecoin you issue.
 *
 * Verification is real. The proof a client sends is a transaction hash, and the
 * guard loads that transaction from Horizon and checks the destination, asset,
 * amount and memo actually match what was demanded. Two protections matter and
 * both are implemented:
 *
 *   - **Replay** — a hash may only be spent once. Without this, one payment
 *     would buy unlimited requests.
 *   - **Wrong-resource reuse** — the memo binds a payment to one specific
 *     challenge, so a payment for a cheap endpoint cannot unlock a dear one.
 */

import {
  RampError,
  assetCode,
  isNative,
  parseAsset,
  truncateMemo,
  type AssetId,
} from '@brk/ramp-core';
import { TESTNET, server, type NetworkConfig } from '../chain/horizon';

export const X402_VERSION = 1;
export const PAYMENT_HEADER = 'x-payment';

export interface X402Requirement {
  /** Pay this exact amount — no partial or streaming settlement. */
  scheme: 'exact';
  network: string;
  asset: AssetId;
  assetCode: string;
  amount: string;
  payTo: string;
  /** Binds a payment to this challenge. Always within Stellar's 28-byte memo limit. */
  memo: string;
  resource: string;
  description?: string;
  maxTimeoutSeconds: number;
}

export interface X402Challenge {
  x402Version: number;
  error: string;
  accepts: X402Requirement[];
}

export interface VerifiedPayment {
  txHash: string;
  from: string;
  amount: string;
  asset: AssetId;
  memo: string;
  ledgerCloseTime: string;
}

export interface X402GuardConfig {
  /** Account that collects payments. */
  payTo: string;
  asset: AssetId;
  /** Price per request, as a decimal string. */
  price: string;
  network?: NetworkConfig;
  networkLabel?: string;
  description?: string;
  /** How long a challenge stays payable. */
  maxTimeoutSeconds?: number;
}

/** Spent transaction hashes. Survives hot reload; a real deployment would use a store. */
const SPENT_KEY = Symbol.for('brk.x402.spent');
const scope = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;

function spent(): Map<string, number> {
  return (scope[SPENT_KEY] ??= new Map());
}

export class X402Guard {
  private readonly config: Required<Omit<X402GuardConfig, 'description'>> & {
    description?: string;
  };

  constructor(config: X402GuardConfig) {
    this.config = {
      payTo: config.payTo,
      asset: config.asset,
      price: config.price,
      network: config.network ?? TESTNET,
      networkLabel: config.networkLabel ?? 'stellar-testnet',
      maxTimeoutSeconds: config.maxTimeoutSeconds ?? 300,
      description: config.description,
    };
  }

  /**
   * The payment terms for a resource.
   *
   * The memo is derived from the resource path rather than being random, so a
   * client can compute it, pay, and retry without holding server state — and a
   * payment for `/premium-fx` still cannot unlock `/premium-something-else`.
   */
  requirement(resource: string): X402Requirement {
    return {
      scheme: 'exact',
      network: this.config.networkLabel,
      asset: this.config.asset,
      assetCode: assetCode(this.config.asset),
      amount: this.config.price,
      payTo: this.config.payTo,
      memo: memoFor(resource),
      resource,
      description: this.config.description,
      maxTimeoutSeconds: this.config.maxTimeoutSeconds,
    };
  }

  /** The body of the 402 response. */
  challenge(resource: string, reason = 'Payment required'): X402Challenge {
    return {
      x402Version: X402_VERSION,
      error: reason,
      accepts: [this.requirement(resource)],
    };
  }

  /**
   * Check a payment against a requirement. Throws `RampError` with a specific
   * code for every distinct failure, so a caller can tell "you underpaid" from
   * "that hash was already used".
   */
  async verify(txHash: string, resource: string): Promise<VerifiedPayment> {
    const requirement = this.requirement(resource);

    // Constructing the client can itself throw — the SDK refuses an insecure
    // Horizon URL, for one. Letting that escape as a raw Error would hand the
    // caller something it cannot branch on, right where the answer must be an
    // unambiguous "not verified".
    let horizon;
    try {
      horizon = server(this.config.network);
    } catch (cause) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        message: `Cannot reach ${this.config.networkLabel} to verify the payment: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        cause,
      });
    }

    if (spent().has(txHash)) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        message: 'That payment has already been used. Each payment buys one request.',
      });
    }

    let transaction;
    try {
      transaction = await horizon.transactions().transaction(txHash).call();
    } catch (cause) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        message: `No transaction ${txHash} on ${this.config.networkLabel}.`,
        cause,
      });
    }

    if (!transaction.successful) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        message: 'That transaction failed on-chain.',
      });
    }

    const memo = transaction.memo ?? '';
    if (memo !== requirement.memo) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        message: `Payment memo "${memo}" does not match "${requirement.memo}" — it was for a different resource.`,
      });
    }

    // Age check: an old payment lying around must not become a free pass.
    const ageSeconds = (Date.now() - new Date(transaction.created_at).getTime()) / 1000;
    if (ageSeconds > this.config.maxTimeoutSeconds) {
      throw new RampError({
        code: 'QUOTE_EXPIRED',
        message: `That payment is ${Math.round(ageSeconds)}s old; the window is ${this.config.maxTimeoutSeconds}s.`,
      });
    }

    const operations = await horizon.operations().forTransaction(txHash).limit(200).call();
    const match = operations.records.find(
      (op) =>
        (op.type === 'payment' || op.type === 'path_payment_strict_send') &&
        'to' in op &&
        op.to === requirement.payTo &&
        matchesAsset(op, requirement.asset) &&
        'amount' in op &&
        Number(op.amount) >= Number(requirement.amount),
    );

    if (!match) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        message:
          `No payment of at least ${requirement.amount} ${requirement.assetCode} to ` +
          `${requirement.payTo} found in that transaction.`,
      });
    }

    spent().set(txHash, Date.now());

    return {
      txHash,
      from: 'from' in match ? String(match.from) : transaction.source_account,
      amount: String((match as { amount: string }).amount),
      asset: requirement.asset,
      memo,
      ledgerCloseTime: transaction.created_at,
    };
  }
}

interface AssetFields {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

function matchesAsset(op: AssetFields, asset: AssetId): boolean {
  if (isNative(asset)) return op.asset_type === 'native';
  const { code, issuer } = parseAsset(asset);
  return op.asset_code === code && op.asset_issuer === issuer;
}

/**
 * A deterministic, memo-safe binding between a payment and a resource.
 *
 * Stellar's MEMO_TEXT is 28 bytes, so this hashes the path into a short token
 * rather than trying to fit the URL. `truncateMemo` is a belt-and-braces guard
 * for the theoretical case where the prefix scheme ever grows.
 */
export function memoFor(resource: string): string {
  let hash = 5381;
  for (let i = 0; i < resource.length; i++) {
    hash = ((hash << 5) + hash + resource.charCodeAt(i)) | 0;
  }
  return truncateMemo(`x402:${(hash >>> 0).toString(36)}`);
}

export function createX402Guard(config: X402GuardConfig): X402Guard {
  return new X402Guard(config);
}
