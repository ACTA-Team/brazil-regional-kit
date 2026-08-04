/**
 * @brk/stablecoin-kit — the on-chain half of the kit.
 *
 * Wallet connection, trustlines, balances, DEX swaps, memo-safe payments and
 * x402 machine payments for regional stablecoins on Stellar. Import
 * `@brk/stablecoin-kit/x402` on its own if you only want the payment middleware.
 */

export * from './wallet/wallet';
export * from './chain/horizon';
export * from './chain/offramp';
export * from './chain/swap';
export * from './x402/x402';
