# @brk/stablecoin-kit

The on-chain half of the kit: wallet, trustlines, balances, DEX swaps,
memo-safe payments and x402 machine payments.

```bash
pnpm add @brk/stablecoin-kit @brk/ramp-core @stellar/stellar-sdk
pnpm add @stellar/freighter-api   # optional, only for browser signing
```

## Wallet

Freighter v4+ *returns* `{ error }` instead of throwing, so every call site that
forgets to check gets `undefined` where an address should be and fails somewhere
far away. This wrapper turns that into a thrown `RampError`, and dynamically
imports the module so the file is safe to import from a server component.

```ts
import { connectWallet, getWalletNetwork, isTestnet, signTransactionXdr } from '@brk/stablecoin-kit';

const address = await connectWallet();
const network = await getWalletNetwork();
if (!isTestnet(network)) { /* tell the user to switch */ }

const signed = await signTransactionXdr(xdr, { address });
```

## Chain

```ts
import { getBalances, hasTrustline, buildTrustlineTx, buildPaymentTx, submitTransaction } from '@brk/stablecoin-kit';

await getBalances(address);          // null when the account is not funded yet
await hasTrustline(address, USDC);
await buildTrustlineTx(address, TESOURO);
await buildPaymentTx({ from, to, asset: USDC, amount: '25', memo: 'Para a família' });
```

`getBalances` returns `null` rather than throwing for an unfunded account —
"no account" is a normal state a ramp UI must render, not an error. `spendable`
accounts for the base reserve, so you do not offer to send XLM the protocol will
not let go of.

`buildPaymentTx` runs the memo through `validateMemo`, so an oversized memo
fails at build time instead of landing on-chain truncated.

## Swaps

```ts
import { quoteSwap, buildSwapTx } from '@brk/stablecoin-kit';

const quote = await quoteSwap({ sellAsset: TESOURO, buyAsset: USDC, sellAmount: '100' });
quote.mode;    // 'dex' — a real path exists, this fills on-chain
quote.destMin; // the floor; the swap fails rather than fill below it

const xdr = await buildSwapTx(quote, address);
```

A `path_payment_strict_send` to yourself: the network finds a route through the
order books and fills it atomically, so either you get at least `destMin` or
nothing happens. No half-swapped state.

When no path exists, `quoteSwap` degrades to `mode: 'simulated'` **only if you
supply a `referencePrice`** — otherwise it refuses. An unroutable pair should be
an error, not a number nobody can justify.

## Off-ramp return leg

Anchors split into two camps and an integration has to handle both: some hand
back a ready-made unsigned transaction, some just tell you where to send the
asset. One call collapses that:

```ts
import { resolveReturnTransaction } from '@brk/stablecoin-kit';

const { xdr, origin } = await resolveReturnTransaction(order, address);
// origin: 'anchor' (sign verbatim) | 'kit' (we built the payment)
```

## x402

```ts
import { createX402Guard, PAYMENT_HEADER } from '@brk/stablecoin-kit/x402';

const guard = createX402Guard({
  payTo: MERCHANT_ACCOUNT,
  asset: TESOURO,   // or USDC, or your own regional stablecoin
  price: '0.10',
});

export async function GET(request: Request) {
  const proof = request.headers.get(PAYMENT_HEADER);
  if (!proof) return Response.json(guard.challenge('/api/thing'), { status: 402 });

  const payment = await guard.verify(proof, '/api/thing');
  return Response.json({ data: '…', paidWith: payment.txHash });
}
```

Verification is real: the guard loads the transaction from Horizon and checks
destination, asset, amount and memo against what it demanded. Two protections
that matter, both implemented:

- **Replay** — a transaction hash may only be spent once. Without this, one
  payment buys unlimited requests.
- **Wrong-resource reuse** — the memo binds a payment to one specific challenge,
  so a payment for a cheap endpoint cannot unlock a dear one.

Payments are also age-checked, so an old transaction lying around does not
become a free pass.
