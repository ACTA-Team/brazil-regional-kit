# @brk/adapter-mocks

Production-shaped adapters for anchors that require commercial onboarding.

```bash
pnpm add @brk/adapter-mocks @brk/ramp-core
```

## Why these exist

Manteca and Koywe have no self-service sandbox — no key you can get on a
weekend — and Koywe is not live in Brazil yet. Two honest options: leave them
out of the router entirely, or model them as adapters that implement the real
interface and are loudly labelled as simulated.

This package takes the second, because the point of the router is that adding an
anchor is one adapter — and demonstrating that costs nothing but honesty about
which quotes are real.

**Nothing here pretends to be live.** `mode` is hard-wired to `mock`, every
quote carries the flag, and the reference UI renders an amber badge for it. When
credentials arrive, replacing the fixture engine with an HTTP client is the only
change needed.

## Use

```ts
import { createMantecaAdapter, createKoyweAdapter, createAllMockAdapters } from '@brk/adapter-mocks';

const adapters = createAllMockAdapters();
```

| Adapter | Corridors | Rail |
|---|---|---|
| Manteca | BRL ↔ USDC, ARS ↔ USDC | PIX, CBU/CVU |
| Koywe | MXN ↔ USDC, CLP → USDC, COP → USDC | SPEI, transferencia, PSE |

Rates in `fixtures/anchors.json` are indicative mid-market references captured
while building, **not** live market data. Quotes wobble deterministically so
consecutive requests are not identical, and latency is simulated so a UI's
loading states actually get exercised.

## Building your own

`MockAnchorAdapter` takes a fixture, so modelling another anchor is a JSON
entry rather than a class:

```ts
import { MockAnchorAdapter } from '@brk/adapter-mocks';

const alfred = new MockAnchorAdapter('alfred', {
  name: 'Alfred Pay',
  countries: ['MX'],
  note: 'Simulated — no public sandbox.',
  latencyMs: [200, 500],
  quoteTtlSeconds: 60,
  corridors: [
    { direction: 'offramp', fiat: 'MXN', asset: 'USDC', country: 'MX',
      rail: 'SPEI', rate: '17.05', feeBps: 120, min: '2', max: '20000' },
  ],
});
```
