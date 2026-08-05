# Anchors

## What is real, honestly

| Anchor | id | Mode | Corridors | Credentials |
|---|---|---|---|---|
| Etherfuse | `etherfuse` | live sandbox, or fixture replay | BRL ↔ TESOURO/USDC (PIX), MXN ↔ MEXE/USDC (SPEI) | Sandbox key, self-service |
| SDF Test Anchor | `testanchor` | **live, always** | USD/CAD ↔ USDC/SRT/XLM (wire) | None |
| Anclap | `anclap` | **live, always** | ARS ↔ their pegged assets (CBU), quotes only | None |

`GET /api/anchors` serves this from the running system, so it cannot drift from
what the code is actually doing.

### Etherfuse

The only Brazilian PIX provider with a self-service sandbox. Get a key at
[devnet.etherfuse.com/ramp](https://devnet.etherfuse.com/ramp), then:

```bash
pnpm setup:etherfuse    # prints the onboarding URL and the ids to keep
pnpm fixtures:record    # capture real responses into the mock fixtures
```

`setup:etherfuse` refuses to run a second time without `--force`. Etherfuse ties
orders to a `customerId`/`bankAccountId` pair; regenerating them orphans every
order created before, and it is an easy mistake to make by accident.

The asset it ramps into on testnet is **TESOURO**, a Brazilian stablebond — not
USDC. The corridor demo bridges that gap with a real DEX swap.

Its API is proprietary, not SEP. Everything specific to it is contained in
`adapter-etherfuse`; see that package's README for the traps.

### SDF Test Anchor

The reason the router has a genuinely live competitor with no signup: **SEP-38
price endpoints are unauthenticated**. `/info`, `/prices` and `/price` answer
without a token, so a client can show real quotes before the user has signed
anything.

It serves USD and CAD against USDC, SRT and XLM. It does **not** serve BRL — so
on the Brazilian corridor Etherfuse is currently unopposed, and the live SEP
anchor appears on the USD side instead. That asymmetry is real: the router shows
`groupSize` so a single-anchor row reads as "the only option" rather than being
dressed up as a winner.

Point `adapter-sep` at any other compliant anchor by changing one env var:

```bash
SEP_ANCHOR_HOME_DOMAIN=anchor.example.com
```

### Anclap

A real regional anchor that answers for itself, registered here for Argentina
over CBU.

This slot used to hold simulated Manteca and Koywe adapters. Neither company
offers a self-service sandbox, so their quotes were indicative numbers captured
by hand — production-shaped, always labelled `mock`, but still numbers this repo
had invented. They were removed in favour of an anchor whose terms can be read
live, because one anchor that answers beats two that we answer for.

The gap they filled was real, though: probing the ecosystem turned up exactly
**one** public SEP-38 quote server. What there is instead is a long tail of
regional anchors that publish a `stellar.toml` and an unauthenticated SEP-24
`/info` carrying assets, limits and fees. That is enough to quote their real
terms, so `adapter-sep` ships a second adapter — `createSepFeeAdapter` — that
speaks the protocol those anchors actually implement.

Their assets are pegged (Anclap's ARS token is one Argentine peso), so a deposit
of X fiat yields X minus the fee they publish. Every number comes from the
anchor; the only thing the adapter contributes is arithmetic.

Two limits, surfaced in code rather than documented and forgotten:

- **Quotes are `indicative`.** Published terms are not a reserved price. Only
  SEP-38 `/quote` gives a firm one, and these anchors do not offer it.
- **They settle on mainnet.** `capabilities().network` says so, because a
  testnet app reads their genuine prices and cannot execute against them. Their
  `createOrder` throws `UNSUPPORTED_PAIR` with that reason rather than
  pretending to open an order.

## Adding an anchor

### If it speaks SEP

Nothing to write.

```ts
import { createSepAdapter } from '@brk/adapter-sep';

const anchor = createSepAdapter({
  mode: 'live',
  homeDomain: 'anchor.example.com',
  id: 'example',
  name: 'Example Anchor',
  defaultCountry: 'BR',
});

await anchor.discover();  // reads stellar.toml and SEP-38 /info
```

Corridors are derived from what `/info` advertises. Register it in
`apps/hub/src/server/anchors.ts`.

If it publishes a fee schedule but no SEP-38 quote server — the common case for
regional anchors — use `createSepFeeAdapter` instead. Same registration, and it
reads limits and fees from SEP-24 `/info`:

```ts
import { createSepFeeAdapter } from '@brk/adapter-sep';

const anchor = createSepFeeAdapter({
  mode: 'live',
  homeDomain: 'anclap.com',
  id: 'anclap',
  name: 'Anclap',
  country: 'AR',
  rail: 'CBU',
});
```

### If it does not

Implement `RampAdapter`. The interface is four required methods:

```ts
import type { RampAdapter, AdapterCapabilities, Quote, Order } from '@brk/ramp-core';

export class ExampleAdapter implements RampAdapter {
  capabilities(): AdapterCapabilities { /* id, name, mode, countries, corridors */ }
  async getQuote(req) { /* → Quote, or throw RampError('UNSUPPORTED_PAIR') */ }
  async createOrder(req) { /* → Order */ }
  async getOrder(id) { /* → Order */ }

  // Optional, and worth implementing if the anchor supports them:
  // regenerateTx, simulateFiatReceived, simulateCryptoReceived, getInteractiveUrl
}
```

Four things to get right, learned the hard way:

**Translate assets at the edge.** Take and return SEP-38 identifiers
(`iso4217:BRL`, `stellar:USDC:GBBD…`). Convert to the anchor's encoding inside
your adapter and nowhere else.

**Normalize errors.** Throw `RampError` with a real code. `UNSUPPORTED_PAIR`
tells the router to skip you quietly; `ANCHOR_UNAVAILABLE` tells it you are
broken. Getting this wrong makes the router's status report useless.

**Map unknown statuses to `processing`, not `failed`.** An anchor inventing a
new intermediate state should stall the UI at worst. Never tell a user their
money failed when it is merely somewhere you have not seen before.

**Be honest about `mode`.** If you are replaying fixtures, say `mock`. The badge
is the whole reason a judge can trust the parts that are real.

Then register it:

```ts
// apps/hub/src/server/anchors.ts
const all: RampAdapter[] = [etherfuse, sep, ...regional, example];
```

The router, the quote table, the corridor payout and the sample app all pick it
up with no further changes.
