# Protocols

What this kit implements, and the parts worth knowing about.

## SEP-1 — stellar.toml discovery

`https://<domain>/.well-known/stellar.toml` is how a client bootstraps an anchor
from nothing but its domain: auth endpoint, quote server, transfer servers,
signing key, supported currencies.

`packages/anchors/sep/src/toml.ts` parses it with a purpose-built reader rather
than a TOML dependency. stellar.toml uses a tiny slice of the format — scalars,
string arrays, `[TABLE]` and `[[ARRAY]]` sections — and the whole point of SEP-1
is minimal bootstrap. Carrying a general-purpose parser to read fifteen keys
would be the wrong trade.

Results are cached for five minutes.

## SEP-38 — quotes

**The load-bearing discovery: `/info`, `/prices` and `/price` need no
authentication.**

That is what makes a multi-anchor router possible without friction. A client can
show live, real quotes from any SEP-38 anchor before the user has signed
anything, created an account or completed KYC.

```bash
curl "https://testanchor.stellar.org/sep38/price?\
sell_asset=stellar:USDC:GBBD47IF...&buy_asset=iso4217:USD&sell_amount=100&context=sep6"
```

```json
{
  "price": "1.0500001591",
  "total_price": "1.0606062213",
  "sell_amount": "100",
  "buy_amount": "94.2857",
  "fee": { "total": "1.00", "asset": "stellar:USDC:GBBD47IF..." }
}
```

Two subtleties the adapter handles:

- `price` excludes fees; `total_price` includes them. The kit reports the
  inverse of `total_price`, so every quote in the app means the same thing —
  buy units per sell unit, after fees.
- Delivery methods (`WIRE`, etc.) are mandatory on the fiat side for most
  anchors, and the anchor tells you which it accepts in `/info`. The adapter
  reads them from discovery rather than guessing.

`POST /quote` is the one endpoint that needs a token. It returns a **firm**
quote: reserved, with an id and a real expiry, rather than an indicative price
that can move under you.

## SEP-10 — authentication

The anchor hands you a transaction and asks you to sign it. That is a genuinely
dangerous shape — a spoofed anchor would love a signature on a real payment.

SEP-10 defends against it with invariants:

- sequence number **0**, so the transaction can never be submitted
- source is the anchor's own `SIGNING_KEY` from its TOML
- a `manage_data` operation naming the expected home domain
- a matching web-auth domain

**This kit verifies all of them, on the server, before the challenge is handed
to a wallet.** `Sep10Client.challenge()` runs `readChallengeTx` and then
double-checks the sequence and the client account itself; if anything fails it
throws rather than returning the XDR. There is no "sign it anyway" path.

```
Browser                    Hub (server)                Anchor
   │  GET /api/sep/challenge    │                         │
   │ ─────────────────────────► │  GET /auth?account=G…   │
   │                            │ ──────────────────────► │
   │                            │ ◄── challenge XDR ───── │
   │                            │  readChallengeTx() ✓    │
   │ ◄─── verified XDR ──────── │                         │
   │  Freighter signs           │                         │
   │  POST /api/sep/token       │                         │
   │ ─────────────────────────► │  POST /auth {signed}    │
   │                            │ ──────────────────────► │
   │ ◄──────── JWT ──────────── │ ◄──────── JWT ───────── │
```

Implementation: `packages/anchors/sep/src/sep10.ts`, wired in
`apps/hub/src/lib/sep.ts` and the `/api/sep/*` routes.

## SEP-24 — interactive deposit and withdraw

The anchor returns a URL; the app opens it in a popup; the anchor owns the KYC
and payment UI inside it. The opposite trade-off to a bespoke integration — far
less control over the experience, but nothing custom to learn, and it works
identically against every SEP-24 anchor in the ecosystem.

Requires a SEP-10 JWT. `POST /api/sep/interactive` in the hub.

## SEP-6 and SEP-31

Not implemented. `adapter-sep` reads their endpoints from the TOML and exposes
them via `metadata()`, so the discovery half is there, but the kit's ordering
path goes through SEP-24 or a bespoke adapter.

## x402 — HTTP 402 Payment Required

A client requests a resource, the server answers `402` with machine-readable
payment terms, the client pays and retries with proof, the server serves the
resource. No accounts, no API keys, no subscription.

```bash
$ curl -i localhost:3000/api/premium-fx
HTTP/1.1 402 Payment Required

{
  "x402Version": 1,
  "error": "Payment required",
  "accepts": [{
    "scheme": "exact",
    "network": "stellar-testnet",
    "asset": "stellar:USDC:GBBD47IF...",
    "amount": "0.10",
    "payTo": "G...",
    "memo": "x402:1u1csvb",
    "resource": "/api/premium-fx",
    "maxTimeoutSeconds": 300
  }]
}

$ curl -H "x-payment: <tx hash>" localhost:3000/api/premium-fx
HTTP/1.1 200 OK
```

Verification is real. The guard loads the transaction from Horizon and checks
destination, asset, amount and memo against what it demanded. Three protections:

| Attack | Defence |
|---|---|
| Replay — one payment, unlimited requests | Spent hashes are recorded and rejected |
| Paying for a cheap endpoint to unlock a dear one | The memo is derived from the resource path and must match |
| Reusing an old payment lying around | Payments are age-checked against `maxTimeoutSeconds` |

The memo is *derived*, not random, so a client can compute it, pay, and retry
without the server holding per-request state — while still binding the payment
to one specific resource.

The guard is asset-agnostic. Pricing an endpoint in TESOURO, USDC or your own
regional stablecoin is one field:

```ts
createX402Guard({ payTo: MERCHANT, asset: TESOURO, price: '0.10' });
```

Implementation: `packages/kit/stablecoin/src/x402.ts`, demonstrated at
`/api/premium-fx` and the `/x402` page.

## Stellar primitives

**Path payments.** The corridor swap is a `path_payment_strict_send` to
yourself: the network routes through the order books and fills atomically, so
either you get at least `destMin` or nothing happens. No half-swapped state to
clean up.

**Trustlines.** An account cannot receive an asset it has no trustline for — the
anchor's payment simply fails. Some anchors hand back a claim transaction for
this; many do not, so the kit builds one itself and checks against the live
network even when the anchor is mocked.

**Memos.** 28 bytes. See [gotchas.md](./gotchas.md).
