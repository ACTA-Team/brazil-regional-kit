# Anchors

## What is real, honestly

| Anchor | id | Mode | Corridors | Credentials |
|---|---|---|---|---|
| Etherfuse | `etherfuse` | live sandbox, or fixture replay | BRL ↔ TESOURO (PIX) | Sandbox key, self-service |
| SDF Test Anchor | `testanchor` | **live, always** | USD/CAD ↔ USDC/SRT/XLM (wire) | None |
| Manteca | `manteca` | simulated | BRL ↔ USDC (PIX), ARS ↔ USDC | Commercial onboarding |
| Koywe | `koywe` | simulated | MXN ↔ USDC (SPEI), CLP/COP → USDC | Commercial onboarding |

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

It serves USD and CAD against USDC, SRT and XLM. It does **not** serve BRL —
so on the Brazilian corridor the competition is Etherfuse against Manteca, and
the live anchor appears on the USD side. That asymmetry is real and the UI shows
it rather than papering over it.

Point `adapter-sep` at any other compliant anchor by changing one env var:

```bash
SEP_ANCHOR_HOME_DOMAIN=anchor.example.com
```

### Manteca and Koywe

Neither has a self-service sandbox. Koywe is live in Chile, Mexico, Colombia and
Peru but **not yet in Brazil**.

Two honest options existed: leave them out of the router, or model them as
adapters that implement the real interface and are loudly labelled as simulated.
This repo takes the second, because the point of the router is that adding an
anchor is one adapter — and demonstrating that costs nothing but honesty about
which quotes are real.

Their `mode` is hard-wired to `mock`. It cannot be configured to `live`, because
there is nothing to be live against. Rates in
`packages/adapter-mocks/fixtures/anchors.json` are indicative mid-market
references captured while building, not market data.

When credentials arrive, replacing the fixture engine with an HTTP client is the
only change needed — the adapter shape, the corridors and the router
registration all stay.

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
`apps/hub/src/lib/anchors.ts`.

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
// apps/hub/src/lib/anchors.ts
const all: RampAdapter[] = [etherfuse, sep, manteca, koywe, example];
```

The router, the quote table, the corridor payout and the sample app all pick it
up with no further changes.
