/**
 * @brk/stablecoin-kit — the on-chain half of the kit.
 *
 * Wallet connection, trustlines, balances, DEX swaps, memo-safe payments and
 * x402 machine payments for regional stablecoins on Stellar. Import
 * `@brk/stablecoin-kit/x402` on its own if you only want the payment middleware.
 */

export * from './wallet';
export * from './horizon';
export * from './offramp';
export * from './swap';
export * from './x402';
