# @brk/ramp-router

One API, many anchors.

```bash
pnpm add @brk/ramp-router @brk/ramp-core
```

## Use

```ts
import { createRampRouter } from '@brk/ramp-router';
import { BRL } from '@brk/ramp-core';

const router = createRampRouter({
  adapters: [etherfuse, testanchor, manteca, koywe],
  defaultTimeoutMs: 6_000,
});

// "I have 500 BRL and I'm in Brazil — what can I get?"
const result = await router.route({ sellAsset: BRL, sellAmount: '500', country: 'BR' });

result.quotes;       // ranked, best-per-destination-asset flagged
result.anchors;      // every anchor consulted, including the ones that failed
result.hasLiveQuote; // is any of this real?
result.elapsedMs;
```

Give it a `buyAsset` for an exact pair; omit it for the open question. That
second mode is what makes it a router rather than a price comparison — it
answers the question a user in a country actually has.

## Three decisions worth knowing about

**A slow anchor cannot hold up a fast one.** Every adapter gets its own deadline
and the fan-out settles rather than races, so one hung anchor costs you its
timeout, not the whole response.

**A failing anchor is data, not an exception.** `result.anchors` reports every
anchor and why each is absent — `unsupported`, `timeout`, `failed`. A router
that silently drops anchors is impossible to debug and impossible to trust.

**Only comparable quotes are compared.** Ranking happens *within* a destination
asset; declaring a winner across MXN and BRL would be meaningless. Each quote
carries `groupSize`, so a UI can tell "best of four" from "the only option" and
not dress the second up as the first.

```ts
for (const q of result.quotes) {
  const contested = q.groupSize > 1;
  console.log(q.anchorName, q.buyAmount, q.mode, contested && q.best ? '← best' : '');
}
```

## Best quote for a pair

```ts
const best = await router.best({
  sellAsset: USDC,
  buyAsset: MXN,
  sellAmount: '100',
  country: 'MX',
});
```
