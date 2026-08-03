# Gotchas

Every entry here cost real time. Each is handled in code, with a pointer to
where — a trap documented in a wiki nobody reads is a trap that gets sprung
again.

## Memos are 28 bytes, not 28 characters

Stellar's `MEMO_TEXT` limit is measured in **bytes**, and Portuguese and Spanish
spend more than one byte on most accented characters.

| Memo | Characters | Bytes | |
|---|---|---|---|
| `Para a familia` | 14 | 14 | ok |
| `Transferência família` | 21 | **23** | ok, but a character counter would mislead |
| `Para meus avós em Guadalajara` | 29 | **30** | over the limit |

An oversized memo does not bounce with a clear error. The payment can land with
the memo truncated or missing — and for an anchor, a transfer with no memo is
one it cannot reconcile to a customer.

**Handled:** `validateMemo()` in `packages/ramp-core/src/memo.ts` throws instead
of truncating, and is called inside `buildPaymentTx`, so an oversized memo fails
at build time. `checkMemo()` drives the live byte counter in `MemoField.tsx`.

## Two USDC issuers on testnet, no shared liquidity

Testnet has more than one asset called USDC. Order books, path payments and
anchor quotes that refer to different issuers can never fill against each other,
and the failure looks like "there is no liquidity" rather than "you picked the
wrong asset".

**Handled:** `USDC` in `packages/ramp-core/src/assets.ts` is pinned to Circle's
issuer `GBBD47IF…`, which is also what `testanchor.stellar.org` serves — so
anchor quotes and DEX offers refer to the same asset.

## Etherfuse: `Authorization` takes a raw key

Not `Bearer <key>`. The raw key. This is the most common way to fail against
their API.

**Handled:** `packages/adapter-etherfuse/src/client.ts`, with a comment saying
why, so nobody "fixes" it.

## Etherfuse: `/ramp/order` is singular

`POST /ramp/orders` does not exist and 404s.

**Handled:** encoded in the `ENDPOINTS` constant in the same file.

## Etherfuse: orders are not readable immediately

An order created a moment ago is not yet indexed; polling straight away returns
not-found. Allow 3–10 seconds.

**Handled:** `ORDER_INDEXING_DELAY_MS`, and `useRampFlow` treats a failed poll
as "keep polling" rather than surfacing an error.

## Etherfuse: never regenerate `customerId`

Etherfuse ties orders to a `customerId`/`bankAccountId` pair. Generating fresh
ids per session orphans every order created before, and the symptom appears
later and elsewhere.

**Handled:** `pnpm setup:etherfuse` writes them once and refuses to run again
without `--force`.

## Passkey wallets expose a `C…` address

Smart-wallet accounts have a contract address that looks like an account
address. Classic anchors cannot settle to it, and a payment sent there is
silently useless.

**Handled:** `assertClassicAddress` in `adapter-etherfuse/src/adapter.ts`
rejects it with an explanation naming the actual problem.

## Freighter returns errors, it does not throw

`@stellar/freighter-api` v4+ resolves to `{ address, error }`. Call sites that
forget to check `error` get `undefined` where an address should be, and fail
somewhere far away with no clue why.

**Handled:** `packages/stablecoin-kit/src/freighter.ts` checks every response
and throws a `RampError`.

## Freighter starts on mainnet

Signing a testnet transaction while the wallet is on the public network wastes
ten confused minutes, reliably.

**Handled:** `NetworkBanner` checks `getNetworkDetails()` and blocks signing
until the user switches.

## Freighter touches `window` at import time

Importing it from a module that a server component also imports crashes the
render.

**Handled:** dynamically imported inside each call in `freighter.ts`, so the
module is safe to import anywhere.

## Anchors answer with HTML, not JSON

An unsupported SEP-38 pair frequently comes back as an HTML error page.
`JSON.parse` then fails, and the error surfaces as
`Unexpected token '<'` — which blames the parser for what is actually "this
anchor does not serve this corridor".

**Handled:** `parseJsonOrNull` in `adapter-sep/src/sep38.ts` distinguishes
"not JSON" from "empty" and maps it to `UNSUPPORTED_PAIR`.

## Horizon buries the useful error

A rejected transaction comes back as `Request failed with status code 400`. The
part you need — `tx_bad_seq`, `op_no_trust`, `op_underfunded` — is four levels
deep in `extras.result_codes`.

**Handled:** `submitTransaction` in `stablecoin-kit/src/horizon.ts` surfaces the
result codes in the message.

## An unfunded account is not an error

A fresh Freighter account has no ledger entry until friendbot funds it. Treating
Horizon's 404 as a failure means the UI cannot render the one state the user
needs to see.

**Handled:** `getBalances` returns `null` for an unfunded account, and
`FundGate` renders a friendbot button.

## XLM balance is not spendable balance

The protocol holds back a base reserve plus 0.5 XLM per subentry. Offering to
send the full balance produces a transaction that cannot succeed.

**Handled:** `Balance.spendable` accounts for reserves.

## Quotes expire in seconds

Etherfuse quotes are short-lived. Without a visible countdown, a user discovers
the quote died only when the order fails — which reads as "the integration is
broken" rather than "the price moved".

**Handled:** `ExpiryPill` counts down; `useRampFlow` catches `QUOTE_EXPIRED` on
confirm, re-quotes silently, and the off-ramp exposes `regenerateTx`.

## `globalThis` caches survive hot reload — including stale shapes

Caching adapters on `globalThis` is what keeps in-flight orders alive across a
hot reload. It also means an object from the *previous* shape of the code
survives and blows up at the first property access.

**Handled:** the registry key is versioned (`brk.anchors.registry.v2`) and the
cached object is shape-checked before reuse.

## Turbopack does not resolve `.js` extensions in TypeScript source

Workspace packages are consumed as TypeScript source via `transpilePackages`.
Node-ESM-style `import './x.js'` fails there. With `moduleResolution: Bundler`,
extensionless imports are correct and work in both dev and `tsup`.

**Handled:** all internal imports are extensionless.

## Padding a coloured string shreds it

In CLI output, `pad(green('ok'), 10)` counts the ANSI escape bytes as width and
truncates mid-sequence. Pad the plain text, then colour it.

**Handled:** `apps/sample-remit/src/index.ts`.
