# @brk/ramp-core

The contract every ramp adapter in this kit implements. Zero dependencies.

Shaped after the SEPs (SEP-38 for quotes, SEP-24/6 for orders) rather than after
any one anchor's private API. That is the whole reason adding an anchor here
costs one adapter instead of one integration.

## Install

```bash
pnpm add @brk/ramp-core
```

## The interface

```ts
import type { RampAdapter } from '@brk/ramp-core';

interface RampAdapter {
  capabilities(): AdapterCapabilities;
  getQuote(req: QuoteRequest): Promise<Quote>;
  createOrder(req: CreateOrderRequest): Promise<Order>;
  getOrder(orderId: string): Promise<Order>;

  regenerateTx?(orderId: string): Promise<Order>;
  simulateFiatReceived?(orderId: string): Promise<Order>;   // sandbox only
  simulateCryptoReceived?(orderId: string): Promise<Order>; // sandbox only
  getInteractiveUrl?(req: QuoteRequest): Promise<string>;
}
```

## Assets

Assets are SEP-38 identifier strings, so an anchor quote and a DEX order book
refer to the same thing:

```ts
import { BRL, USDC, TESOURO, fiat, stellarAsset, parseAsset } from '@brk/ramp-core';

BRL      // 'iso4217:BRL'
USDC     // 'stellar:USDC:GBBD47IF...'
fiat('MXN');
stellarAsset('BRZ', 'GABMA6FP...');
parseAsset(USDC); // { scheme: 'stellar', code: 'USDC', issuer: 'GBBD47IF...' }
```

`USDC` is pinned to Circle's testnet issuer. There are two USDC issuers on
testnet with **no shared liquidity**, so the wrong one silently produces an
unfillable market.

## Memos

Stellar's `MEMO_TEXT` limit is **28 bytes, not 28 characters** — and Portuguese
and Spanish spend more than one byte on most accented characters. An oversized
memo does not bounce cleanly; the payment can land with the memo truncated or
missing, and the anchor never credits the customer.

```ts
import { checkMemo, validateMemo } from '@brk/ramp-core';

checkMemo('Transferência família');
// { valid: true, bytes: 23, max: 28, remaining: 5 }   ← 21 characters, 23 bytes

validateMemo('Para meus avós em Guadalajara');
// throws RampError('INVALID_REQUEST') — 30 bytes
```

Use `checkMemo` to drive a live counter in a form, `validateMemo` on the payment
path.

## Money

Amounts stay decimal strings end to end. Anchors quote in strings, Stellar
operations take strings, and `0.1 + 0.2` in float is how you end up off by a
centavo on stage.

```ts
import { add, multiply, applyBps, compare, round } from '@brk/ramp-core';

applyBps('500', 120); // '6' — a 1.2% fee
compare('10.5', '10.50'); // 0
```

## Errors

Every anchor failure normalizes to one `RampError` with a code the caller can
branch on: `UNSUPPORTED_PAIR`, `ANCHOR_UNAVAILABLE`, `QUOTE_EXPIRED`,
`AMOUNT_OUT_OF_RANGE`, `KYC_REQUIRED`, `AUTH_FAILED`, `INVALID_REQUEST`,
`INVALID_ORDER_STATE`, `CHAIN_ERROR`, `UNKNOWN`.

`toJSON()` deliberately omits the raw anchor payload, which can hold customer
data — safe to return from an API route.

## Modes

```ts
import { resolveMode } from '@brk/ramp-core';

resolveMode({
  adapterEnv: process.env.ETHERFUSE_MODE, // per-adapter override
  globalEnv: process.env.RAMP_MODE,       // global default
  liveAvailable: Boolean(apiKey),         // degrade instead of failing
});
```

Defaults to `mock`, so a fresh clone with no credentials runs immediately.
