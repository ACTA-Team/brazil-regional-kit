# Privacy

What this software does with data, in plain terms.

## The short version

The kit has **no database, no analytics, no tracking and no accounts**. It
stores nothing about you on a server, because it has no server-side storage at
all.

## What stays in your browser

| Stored | Where | Why |
|---|---|---|
| Language preference | `localStorage` (`brk.locale`) | So the app opens in the language you chose |
| Connected wallet address | `localStorage` (`brk.wallet.address`) | So it reconnects silently instead of prompting every reload |

Clearing site data removes both. Neither is sent anywhere.

## What leaves your machine

Running the hub, three kinds of request go out:

**To Stellar Horizon** — balances, trustlines, order books, and transaction
submission. Your public address is part of these requests, as it must be to ask
about your own account. Stellar is a public ledger: anything settled on it is
public by design and permanent, including memos.

**To anchors** — quotes and orders. In live mode, the amount, the corridor and
your public address go to that anchor. In mock mode (the default) no request
leaves your machine at all.

**To an anchor's KYC flow** — only if you open one. SEP-24 hands you a URL and
the anchor owns everything inside it, including whatever identity documents it
asks for. That data goes to the anchor under the anchor's privacy policy, never
through this software.

Nothing else. There is no telemetry, no error reporting service and no third
party embedded in the page.

## Private keys

This software never sees your secret key.

Transactions are built unsigned, handed to the Freighter extension, and come
back signed. The key stays in the extension. The one exception is
`pnpm seed:liquidity`, an optional operator script that generates a **disposable
testnet** keypair, prints it for you to reuse, and is documented as never
holding a mainnet key.

## What the server logs

The hub is a Next.js app with no logging beyond errors written to the process
output. Those may include an anchor's error message, which is why
`RampError.toJSON()` drops the raw anchor payload before anything is returned to
a browser.

Deployment platforms keep their own request logs — typically IP addresses,
paths and timestamps. That is your host's behaviour, not this software's; check
your provider's policy if it matters to you.

## Anchor data

When you use an anchor, you enter that anchor's relationship, not ours. KYC
identity, bank account details and transaction records are held by them under
their own terms. This kit passes an anchor-scoped `customerId` and a bank
account id through; it never stores or inspects the underlying documents.

## Memos are public

A memo attached to a Stellar payment is stored on the public ledger forever and
readable by anyone. The corridor demo defaults to `"Para a família"` for a
reason — put nothing in a memo you would not publish.

## If you deploy this

You take on responsibility for anything your deployment adds. If you introduce
analytics, error reporting or storage, this document stops describing your
deployment and you will need your own.
