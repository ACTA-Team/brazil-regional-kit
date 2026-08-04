/**
 * x402 verification, against a Horizon we control.
 *
 * `x402.test.ts` covers the terms and the "Horizon is unreachable" direction
 * while staying network-free. That leaves the part the README makes its
 * strongest claim about — *"a hash may only be spent once"* — resting on a
 * comment. This file pins it down: the guard is handed a fabricated ledger and
 * asked to accept exactly one request per payment, and to reject every way a
 * payment can be wrong.
 *
 * The mock lives in its own file rather than in `x402.test.ts` because mocking
 * `./horizon` there would defeat the unreachable-Horizon tests that file exists
 * to run.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USDC, parseAsset } from '@brk/ramp-core';

interface FakeTransaction {
  successful: boolean;
  memo?: string;
  created_at: string;
  source_account: string;
}

interface FakeOperation {
  type: string;
  to?: string;
  from?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

/** Mutable ledger the mocked Horizon reads from. Hoisted with the mock factory. */
const ledger = vi.hoisted(() => ({
  transaction: null as unknown,
  operations: [] as unknown[],
  missing: false,
}));

vi.mock('./horizon', () => ({
  TESTNET: {
    horizonUrl: 'https://horizon.example',
    networkPassphrase: 'Test SDF Network ; September 2015',
  },
  server: () => ({
    transactions: () => ({
      transaction: () => ({
        call: async () => {
          if (ledger.missing) throw new Error('Request failed with status code 404');
          return ledger.transaction;
        },
      }),
    }),
    operations: () => ({
      forTransaction: () => ({
        limit: () => ({ call: async () => ({ records: ledger.operations }) }),
      }),
    }),
  }),
}));

// Imported after the mock — vitest hoists `vi.mock` above this.
const { createX402Guard, memoFor } = await import('./x402');

const PAY_TO = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const PAYER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const RESOURCE = '/api/premium-fx';
const HASH = 'a'.repeat(64);

const { code: USDC_CODE, issuer: USDC_ISSUER } = parseAsset(USDC);

const guard = () => createX402Guard({ payTo: PAY_TO, asset: USDC, price: '0.10' });

/** A transaction that satisfies every requirement, unless a test breaks one. */
function goodPayment(overrides: Partial<FakeTransaction> = {}): FakeTransaction {
  return {
    successful: true,
    memo: memoFor(RESOURCE),
    created_at: new Date().toISOString(),
    source_account: PAYER,
    ...overrides,
  };
}

function goodOperation(overrides: Partial<FakeOperation> = {}): FakeOperation {
  return {
    type: 'payment',
    to: PAY_TO,
    from: PAYER,
    amount: '0.10',
    asset_type: 'credit_alphanum4',
    asset_code: USDC_CODE,
    asset_issuer: USDC_ISSUER,
    ...overrides,
  };
}

beforeEach(() => {
  // The spent-hash set hangs off globalThis so it survives hot reload; that also
  // means it survives between tests, which would make them order-dependent.
  const scope = globalThis as unknown as Record<symbol, unknown>;
  scope[Symbol.for('brk.x402.spent')] = undefined;

  ledger.transaction = goodPayment();
  ledger.operations = [goodOperation()];
  ledger.missing = false;
});

describe('a valid payment', () => {
  it('is accepted and reports what settled', async () => {
    const payment = await guard().verify(HASH, RESOURCE);

    expect(payment).toMatchObject({
      txHash: HASH,
      from: PAYER,
      amount: '0.10',
      asset: USDC,
      memo: memoFor(RESOURCE),
    });
  });

  it('is accepted when it overpays — the requirement is a floor, not an equality', async () => {
    ledger.operations = [goodOperation({ amount: '5' })];
    await expect(guard().verify(HASH, RESOURCE)).resolves.toMatchObject({ amount: '5' });
  });

  it('is accepted when it arrives as a path payment rather than a plain one', async () => {
    ledger.operations = [goodOperation({ type: 'path_payment_strict_send' })];
    await expect(guard().verify(HASH, RESOURCE)).resolves.toMatchObject({ txHash: HASH });
  });

  it('is found among unrelated operations in the same transaction', async () => {
    ledger.operations = [
      goodOperation({ to: PAYER, amount: '999' }),
      goodOperation({ type: 'change_trust' }),
      goodOperation(),
    ];
    await expect(guard().verify(HASH, RESOURCE)).resolves.toMatchObject({ amount: '0.10' });
  });
});

describe('replay', () => {
  /**
   * The claim the whole scheme rests on. Without it one payment buys unlimited
   * requests and the endpoint is free to anyone who has paid once, ever.
   */
  it('spends a hash exactly once', async () => {
    const g = guard();

    await expect(g.verify(HASH, RESOURCE)).resolves.toMatchObject({ txHash: HASH });
    await expect(g.verify(HASH, RESOURCE)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('reports the reason precisely enough for a client to stop retrying', async () => {
    const g = guard();
    await g.verify(HASH, RESOURCE);

    await expect(g.verify(HASH, RESOURCE)).rejects.toThrow(/already been used/i);
  });

  /** The ledger is shared, so a second guard instance must not reopen the door. */
  it('holds across guard instances, not just within one', async () => {
    await guard().verify(HASH, RESOURCE);
    await expect(guard().verify(HASH, RESOURCE)).rejects.toThrow(/already been used/i);
  });

  /** A rejected payment must not be marked spent, or a fixable mistake is fatal. */
  it('does not burn the hash when verification failed', async () => {
    ledger.operations = [goodOperation({ amount: '0.01' })];
    await expect(guard().verify(HASH, RESOURCE)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });

    ledger.operations = [goodOperation()];
    await expect(guard().verify(HASH, RESOURCE)).resolves.toMatchObject({ txHash: HASH });
  });
});

describe('a payment that does not match the terms', () => {
  it('is rejected when the memo was for another resource', async () => {
    ledger.transaction = goodPayment({ memo: memoFor('/api/something-cheaper') });
    await expect(guard().verify(HASH, RESOURCE)).rejects.toThrow(/different resource/i);
  });

  it('is rejected when there is no memo at all', async () => {
    ledger.transaction = goodPayment({ memo: undefined });
    await expect(guard().verify(HASH, RESOURCE)).rejects.toThrow(/different resource/i);
  });

  it('is rejected when it underpays', async () => {
    ledger.operations = [goodOperation({ amount: '0.09' })];
    await expect(guard().verify(HASH, RESOURCE)).rejects.toThrow(/No payment of at least/i);
  });

  it('is rejected when it paid somebody else', async () => {
    ledger.operations = [goodOperation({ to: PAYER })];
    await expect(guard().verify(HASH, RESOURCE)).rejects.toThrow(/No payment of at least/i);
  });

  it('is rejected when it paid the right amount of the wrong asset', async () => {
    ledger.operations = [goodOperation({ asset_code: 'BRL' })];
    await expect(guard().verify(HASH, RESOURCE)).rejects.toThrow(/No payment of at least/i);
  });

  /** Same code, different issuer — the trap this repo pins an issuer to avoid. */
  it('is rejected when the asset code matches but the issuer does not', async () => {
    ledger.operations = [goodOperation({ asset_issuer: PAYER })];
    await expect(guard().verify(HASH, RESOURCE)).rejects.toThrow(/No payment of at least/i);
  });

  it('is rejected when the transaction failed on-chain', async () => {
    ledger.transaction = goodPayment({ successful: false });
    await expect(guard().verify(HASH, RESOURCE)).rejects.toThrow(/failed on-chain/i);
  });

  it('is rejected when it is older than the payment window', async () => {
    ledger.transaction = goodPayment({
      created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    await expect(guard().verify(HASH, RESOURCE)).rejects.toMatchObject({
      code: 'QUOTE_EXPIRED',
    });
  });

  it('is rejected when no such transaction exists', async () => {
    ledger.missing = true;
    await expect(guard().verify(HASH, RESOURCE)).rejects.toThrow(/No transaction/i);
  });
});
