/**
 * DEX swaps via path payments.
 *
 * The kit needs to turn a local stablebond into the asset a remittance actually
 * travels in. On Stellar that is a `path_payment_strict_send` to yourself: the
 * network finds a route through the order books and fills it atomically, so
 * either you get at least `destMin` or nothing happens at all. There is no
 * half-swapped state to clean up.
 *
 * Two modes, and the difference is always visible to the user:
 *
 *   - `dex` — a real path exists on the live order books and the swap settles
 *     on-chain. This is the default and what the demo aims for.
 *   - `simulated` — no path exists for this pair (a normal testnet situation
 *     for a thin market). The kit computes a cross-rate instead and labels the
 *     result as simulated. It never silently pretends a fill happened.
 */

import { BASE_FEE, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { RampError, applyBps, divide, multiply, subtract, type AssetId } from '@brk/ramp-core';
import { TESTNET, server, toSdkAsset, type NetworkConfig } from './horizon';

export type SwapMode = 'dex' | 'simulated';

export interface SwapQuote {
  mode: SwapMode;
  sellAsset: AssetId;
  buyAsset: AssetId;
  sellAmount: string;
  buyAmount: string;
  /** Floor accepted on-chain, after slippage. The swap fails rather than fill below it. */
  destMin: string;
  price: string;
  /** Intermediate assets the path routes through. Empty means a direct market. */
  path: AssetId[];
  slippageBps: number;
  /** Why this is simulated. Only set when `mode` is `simulated`. */
  reason?: string;
}

export interface SwapQuoteInput {
  sellAsset: AssetId;
  buyAsset: AssetId;
  sellAmount: string;
  /** Default 100bps (1%). Tight enough to matter, loose enough to fill. */
  slippageBps?: number;
  /**
   * Fallback rate used only when no DEX path exists. Supply one composed from
   * anchor quotes; without it, an unroutable pair is an error rather than a
   * made-up number.
   */
  referencePrice?: string;
  /** Explains where `referencePrice` came from, shown in the UI. */
  referenceLabel?: string;
}

const DEFAULT_SLIPPAGE_BPS = 100;

export async function quoteSwap(
  input: SwapQuoteInput,
  config: NetworkConfig = TESTNET,
): Promise<SwapQuote> {
  const slippageBps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

  if (input.sellAsset === input.buyAsset) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: 'Cannot swap an asset for itself.',
    });
  }

  const sellSdk = toSdkAsset(input.sellAsset);
  const buySdk = toSdkAsset(input.buyAsset);

  let best:
    | { destination_amount: string; path: Array<{ asset_code?: string; asset_issuer?: string }> }
    | undefined;

  try {
    const paths = await server(config).strictSendPaths(sellSdk, input.sellAmount, [buySdk]).call();

    // Records come back best-first, but be explicit rather than trusting order.
    best = paths.records.reduce<typeof best>((top, record) => {
      if (!top || Number(record.destination_amount) > Number(top.destination_amount)) {
        return record as NonNullable<typeof best>;
      }
      return top;
    }, undefined);
  } catch (e) {
    // A Horizon hiccup should not be reported as "no liquidity" — fall through
    // to the reference price with the real reason attached.
    return simulated(input, slippageBps, `Path lookup failed: ${describe(e)}`);
  }

  if (!best) {
    return simulated(
      input,
      slippageBps,
      `No path from ${input.sellAsset} to ${input.buyAsset} on the order books.`,
    );
  }

  const buyAmount = best.destination_amount;

  return {
    mode: 'dex',
    sellAsset: input.sellAsset,
    buyAsset: input.buyAsset,
    sellAmount: input.sellAmount,
    buyAmount,
    destMin: subtract(buyAmount, applyBps(buyAmount, slippageBps)),
    price: safeDivide(buyAmount, input.sellAmount),
    path: best.path.map((hop) =>
      hop.asset_code && hop.asset_issuer
        ? `stellar:${hop.asset_code}:${hop.asset_issuer}`
        : 'stellar:native',
    ),
    slippageBps,
  };
}

function simulated(input: SwapQuoteInput, slippageBps: number, reason: string): SwapQuote {
  if (!input.referencePrice) {
    throw new RampError({
      code: 'UNSUPPORTED_PAIR',
      message: `${reason} Supply a referencePrice to price it off-book instead.`,
    });
  }

  const buyAmount = multiply(input.sellAmount, input.referencePrice);

  return {
    mode: 'simulated',
    sellAsset: input.sellAsset,
    buyAsset: input.buyAsset,
    sellAmount: input.sellAmount,
    buyAmount,
    destMin: buyAmount,
    price: input.referencePrice,
    path: [],
    slippageBps,
    reason: input.referenceLabel ? `${reason} Priced ${input.referenceLabel}.` : reason,
  };
}

/**
 * Build the unsigned swap. Source and destination are the same account — this
 * is a self-payment whose only purpose is to move through the order books.
 */
export async function buildSwapTx(
  quote: SwapQuote,
  address: string,
  config: NetworkConfig = TESTNET,
): Promise<string> {
  if (quote.mode !== 'dex') {
    throw new RampError({
      code: 'UNSUPPORTED_PAIR',
      message: 'A simulated swap has no on-chain transaction — there is no path to execute.',
    });
  }

  const account = await server(config).loadAccount(address);

  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset: toSdkAsset(quote.sellAsset),
        sendAmount: quote.sellAmount,
        destination: address,
        destAsset: toSdkAsset(quote.buyAsset),
        destMin: quote.destMin,
        path: quote.path.map(toSdkAsset),
      }),
    )
    .setTimeout(120)
    .build()
    .toXDR();
}

function safeDivide(a: string, b: string): string {
  try {
    return divide(a, b);
  } catch {
    return '0';
  }
}

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));
