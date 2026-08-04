# @brk/adapter-etherfuse

Etherfuse ramp adapter — BRL ↔ TESOURO over PIX. Live sandbox, or a faithful
fixture-backed simulator.

```bash
pnpm add @brk/adapter-etherfuse @brk/ramp-core
```

## Use

```ts
import { createEtherfuseAdapter } from '@brk/adapter-etherfuse';
import { BRL, TESOURO } from '@brk/ramp-core';

const etherfuse = createEtherfuseAdapter({
  mode: 'live',                                   // or 'mock'
  apiKey: process.env.ETHERFUSE_API_KEY,
  customerId: process.env.ETHERFUSE_CUSTOMER_ID,
  bankAccountId: process.env.ETHERFUSE_BANK_ACCOUNT_ID,
});

const quote = await etherfuse.getQuote({
  sellAsset: BRL,
  buyAsset: TESOURO,
  sellAmount: '500',
  account: 'GDUY7J7A...',
});

const order = await etherfuse.createOrder({ quoteId: quote.id, account: 'GDUY7J7A...' });
order.paymentInstructions; // { type: 'pix', code: '00020101...', amount, currency }

await etherfuse.simulateFiatReceived(order.id); // sandbox only
```

## Mock mode

Not a parallel implementation that can drift — the same adapter over a different
transport. It models the parts that matter: quotes that really expire, orders
that sit in `PENDING_PAYMENT` until the PIX is simulated, settlement that takes
a couple of seconds rather than returning `COMPLETED` instantly.

The PIX code it produces is a structurally real EMV BR Code — correct TLV
layout, correct CRC16 — so a Brazilian bank app parses it instead of rejecting
it. The key is a non-routable sandbox address, so it parses and then goes
nowhere, which is exactly what a demo wants.

Run `pnpm fixtures:record` against the live sandbox and mock mode replays real
captured rates, fees and limits. Identifying fields are stripped before anything
is written.

## Traps this adapter already handles

Every one of these is a real hour someone lost:

| Trap | What happens |
|---|---|
| `Authorization: Bearer <key>` | Rejected. Etherfuse takes the **raw** key. |
| `POST /ramp/orders` | 404. The endpoint is **singular**: `/ramp/order`. |
| Polling immediately after creating an order | Not found. It needs 3–10s to index. |
| Regenerating `customerId` per session | Orphans every in-flight order. Create once, reuse forever. |
| Passing a passkey wallet's `C…` address | Looks like an address, is silently useless. Adapter rejects it with an explanation. |
| Quote expiry | Seconds, not minutes. Use `regenerateTx` on the retry path. |

## Also exported

```ts
import { buildPixPayload, isValidPixPayload, crc16 } from '@brk/adapter-etherfuse';
```

A standalone BR Code builder and validator, useful on its own.
