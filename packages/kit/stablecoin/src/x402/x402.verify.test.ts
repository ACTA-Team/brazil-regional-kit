/**
 * x402 payment verification.
 *
 * This is the money check: it decides whether an HTTP request has been paid
 * for. Every test below is a way of not paying — replaying a hash, paying the
 * wrong account, paying in the wrong asset, underpaying, reusing a payment made
 * for a cheaper endpoint, presenting a transaction that failed on-chain — and
 * every one of them must be refused.
 *
 * Horizon is stubbed because it is the external ledger. The comparisons, the
 * replay ledger and the memo binding are the code under test and run for real.
 *
 * The spent-hash ledger lives on `globalThis`, so each test uses its own
 * transaction hash. Sharing one would make these pass or fail by ordering.
 *
 * The unreachable-Horizon cases live in `x402.test.ts`, which deliberately does
 * not stub the network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USDC } from '@brk/ramp-core';
import { createX402Guard, memoFor } from './x402';
import { server } from '../chain/horizon';

vi.mock('../chain/horizon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chain/horizon')>()),
  server: vi.fn(),
}));

const PAY_TO = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const PAYER = 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const RESOURCE = '/api/premium-fx';

const guard = (price = '0.10') => createX402Guard({ payTo: PAY_TO, asset: USDC, price });

/** A distinct 64-hex hash per test, so the replay ledger cannot leak between them. */
let hashCounter = 0;
const freshHash = () => String(++hashCounter).padStart(64, '0');

interface Op {
  type?: string;
  to?: string;
  from?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

interface TxOverrides {
  successful?: boolean;
  memo?: string;
  created_at?: string;
  source_account?: string;
}

/** A payment operation that satisfies the default guard. */
const goodOp = (overrides: Op = {}): Op => ({
  type: 'payment',
  to: PAY_TO,
  from: PAYER,
  amount: '0.10',
  asset_type: 'credit_alphanum4',
  asset_code: 'USDC',
  asset_issuer: ISSUER,
  ...overrides,
});

function stubHorizon(options: { tx?: TxOverrides; ops?: Op[]; txThrows?: boolean } = {}) {
  const transaction = {
    successful: true,
    memo: memoFor(RESOURCE),
    created_at: new Date().toISOString(),
    source_account: PAYER,
    ...options.tx,
  };

  vi.mocked(server).mockReturnValue({
    transactions: () => ({
      transaction: () => ({
        call: async () => {
          if (options.txThrows) throw new Error('Not Found');
          return transaction;
        },
      }),
    }),
    operations: () => ({
      forTransaction: () => ({
        limit: () => ({ call: async () => ({ records: options.ops ?? [goodOp()] }) }),
      }),
    }),
  } as unknown as ReturnType<typeof server>);
}

beforeEach(() => {
  vi.mocked(server).mockReset();
});

describe('a genuine payment', () => {
  it('is accepted and reported back in full', async () => {
    stubHorizon();
    const hash = freshHash();

    await expect(guard().verify(hash, RESOURCE)).resolves.toMatchObject({
      txHash: hash,
      from: PAYER,
      amount: '0.10',
      asset: USDC,
      memo: memoFor(RESOURCE),
    });
  });

  it('accepts an overpayment', async () => {
    stubHorizon({ ops: [goodOp({ amount: '5.00' })] });

    await expect(guard().verify(freshHash(), RESOURCE)).resolves.toMatchObject({ amount: '5.00' });
  });

  it('accepts a path payment, not only a direct one', async () => {
    stubHorizon({ ops: [goodOp({ type: 'path_payment_strict_send' })] });

    await expect(guard().verify(freshHash(), RESOURCE)).resolves.toBeTruthy();
  });

  it('finds the paying operation among unrelated ones', async () => {
    stubHorizon({
      ops: [{ type: 'manage_data' }, goodOp({ to: 'GSOMEONEELSE' }), goodOp({ amount: '0.10' })],
    });

    await expect(guard().verify(freshHash(), RESOURCE)).resolves.toBeTruthy();
  });

  /**
   * Horizon omits a field it has no value for rather than sending null, so the
   * operation here is built without `from` instead of with an undefined one.
   */
  it('falls back to the transaction source when the operation names no payer', async () => {
    const { from: _from, ...withoutPayer } = goodOp();
    stubHorizon({ ops: [withoutPayer], tx: { source_account: 'GFALLBACK' } });

    await expect(guard().verify(freshHash(), RESOURCE)).resolves.toMatchObject({
      from: 'GFALLBACK',
    });
  });

  it('reports the ledger close time it verified against', async () => {
    const created = new Date(Date.now() - 5_000).toISOString();
    stubHorizon({ tx: { created_at: created } });

    await expect(guard().verify(freshHash(), RESOURCE)).resolves.toMatchObject({
      ledgerCloseTime: created,
    });
  });

  it('prices in whatever asset the guard was configured with', async () => {
    const tesouro = createX402Guard({
      payTo: PAY_TO,
      asset: 'stellar:TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4',
      price: '1',
    });
    stubHorizon({
      ops: [
        goodOp({
          amount: '1',
          asset_code: 'TESOURO',
          asset_issuer: 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4',
        }),
      ],
    });

    await expect(tesouro.verify(freshHash(), RESOURCE)).resolves.toBeTruthy();
  });
});

describe('replay', () => {
  /** Without this, one payment buys unlimited requests. */
  it('refuses a hash that has already bought a request', async () => {
    stubHorizon();
    const hash = freshHash();

    await expect(guard().verify(hash, RESOURCE)).resolves.toBeTruthy();
    await expect(guard().verify(hash, RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringMatching(/already been used/i),
    });
  });

  it('remembers a spent hash across guard instances', async () => {
    stubHorizon();
    const hash = freshHash();

    await guard().verify(hash, RESOURCE);
    await expect(guard().verify(hash, RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  /**
   * A rejected attempt must not burn the hash — otherwise a third party who
   * learns of a payment could spend it against the wrong resource first and
   * lock the payer out of the one they actually paid for.
   */
  it('does not consume a hash that failed verification', async () => {
    const hash = freshHash();

    stubHorizon({ ops: [goodOp({ amount: '0.01' })] });
    await expect(guard().verify(hash, RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });

    stubHorizon({ ops: [goodOp()] });
    await expect(guard().verify(hash, RESOURCE)).resolves.toBeTruthy();
  });
});

describe('payments that do not pay for this request', () => {
  /**
   * The memo binds a payment to one resource. Without the check, a payment for
   * a cheap endpoint would unlock an expensive one.
   */
  it('refuses a payment whose memo names a different resource', async () => {
    stubHorizon({ tx: { memo: memoFor('/api/something-cheap') } });

    await expect(guard().verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringMatching(/different resource/i),
    });
  });

  it('refuses a payment carrying no memo at all', async () => {
    stubHorizon({ tx: { memo: undefined } });

    await expect(guard().verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('refuses a payment sent to a different account', async () => {
    stubHorizon({ ops: [goodOp({ to: 'GNOTTHEPAYEE' })] });

    await expect(guard().verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringMatching(/No payment of at least/i),
    });
  });

  it('refuses an underpayment', async () => {
    stubHorizon({ ops: [goodOp({ amount: '0.09' })] });

    await expect(guard().verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  /** Paying 0.10 of a worthless look-alike asset must not buy anything. */
  it('refuses payment in an asset with the right code but the wrong issuer', async () => {
    stubHorizon({ ops: [goodOp({ asset_issuer: 'GFAKEISSUER' })] });

    await expect(guard().verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('refuses payment in a different asset entirely', async () => {
    stubHorizon({
      ops: [goodOp({ asset_type: 'native', asset_code: undefined, asset_issuer: undefined })],
    });

    await expect(guard().verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('refuses a credit payment when the guard prices the resource in XLM', async () => {
    const native = createX402Guard({ payTo: PAY_TO, asset: 'stellar:native', price: '1' });
    stubHorizon({ ops: [goodOp({ amount: '1' })] });

    await expect(native.verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('accepts an XLM payment when the guard prices the resource in XLM', async () => {
    const native = createX402Guard({ payTo: PAY_TO, asset: 'stellar:native', price: '1' });
    stubHorizon({
      ops: [
        goodOp({
          amount: '1',
          asset_type: 'native',
          asset_code: undefined,
          asset_issuer: undefined,
        }),
      ],
    });

    await expect(native.verify(freshHash(), RESOURCE)).resolves.toBeTruthy();
  });

  it('refuses a transaction with no operations', async () => {
    stubHorizon({ ops: [] });

    await expect(guard().verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});

describe('payments that are not valid on-chain', () => {
  it('refuses a transaction that failed on the ledger', async () => {
    stubHorizon({ tx: { successful: false } });

    await expect(guard().verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringMatching(/failed on-chain/i),
    });
  });

  it('refuses a hash that is not on the ledger at all', async () => {
    stubHorizon({ txThrows: true });

    await expect(guard().verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringMatching(/No transaction/i),
    });
  });

  /** An old payment lying around must not become a permanent free pass. */
  it('refuses a payment older than the window', async () => {
    stubHorizon({ tx: { created_at: new Date(Date.now() - 400_000).toISOString() } });

    await expect(guard().verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'QUOTE_EXPIRED',
    });
  });

  it('accepts a payment just inside the window', async () => {
    stubHorizon({ tx: { created_at: new Date(Date.now() - 60_000).toISOString() } });

    await expect(guard().verify(freshHash(), RESOURCE)).resolves.toBeTruthy();
  });

  it('honours a shorter configured window', async () => {
    const strict = createX402Guard({
      payTo: PAY_TO,
      asset: USDC,
      price: '0.10',
      maxTimeoutSeconds: 30,
    });
    stubHorizon({ tx: { created_at: new Date(Date.now() - 60_000).toISOString() } });

    await expect(strict.verify(freshHash(), RESOURCE)).rejects.toMatchObject({
      code: 'QUOTE_EXPIRED',
    });
  });
});
