/**
 * Resolving the on-chain half of an off-ramp.
 *
 * Anchors split into two camps — one hands back a ready-made transaction, the
 * other just names an account to pay. Getting this wrong sends a user's money
 * to the wrong place, so the branches are worth pinning individually.
 *
 * Only `buildPaymentTx` is mocked: it loads an account from Horizon, which is
 * the external dependency here. The branching logic under test is real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TESOURO, USDC, type Order } from '@brk/ramp-core';
import { resolveReturnTransaction } from './offramp';
import { buildPaymentTx } from './horizon';

vi.mock('./horizon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./horizon')>()),
  buildPaymentTx: vi.fn(async () => 'BUILT_XDR'),
}));

const ADDRESS = 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4';
const ANCHOR_ACCOUNT = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    anchorId: 'etherfuse',
    anchorName: 'Etherfuse',
    mode: 'mock',
    direction: 'offramp',
    status: 'awaiting_signature',
    sellAsset: TESOURO,
    buyAsset: 'iso4217:BRL',
    sellAmount: '100',
    buyAmount: '500',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    history: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(buildPaymentTx).mockClear();
});

describe('anchors that supply their own transaction', () => {
  /**
   * The anchor chose the memo and the destination and will reconcile against
   * exactly those. Rebuilding it here would change both.
   */
  it('signs the anchor’s transaction verbatim', async () => {
    const result = await resolveReturnTransaction(order({ unsignedTxXdr: 'ANCHOR_XDR' }), ADDRESS);

    expect(result).toEqual({ xdr: 'ANCHOR_XDR', origin: 'anchor' });
    expect(vi.mocked(buildPaymentTx)).not.toHaveBeenCalled();
  });

  it('prefers the anchor’s transaction even when an account is also given', async () => {
    const result = await resolveReturnTransaction(
      order({ unsignedTxXdr: 'ANCHOR_XDR', anchorAccount: ANCHOR_ACCOUNT }),
      ADDRESS,
    );

    expect(result.origin).toBe('anchor');
    expect(vi.mocked(buildPaymentTx)).not.toHaveBeenCalled();
  });
});

describe('anchors that only name a destination', () => {
  it('builds a payment to the anchor’s account for the amount being sold', async () => {
    const result = await resolveReturnTransaction(
      order({ anchorAccount: ANCHOR_ACCOUNT, anchorMemo: 'ref-123' }),
      ADDRESS,
    );

    expect(result).toEqual({ xdr: 'BUILT_XDR', origin: 'kit' });
    expect(vi.mocked(buildPaymentTx)).toHaveBeenCalledWith(
      {
        from: ADDRESS,
        to: ANCHOR_ACCOUNT,
        asset: TESOURO,
        amount: '100',
        memo: 'ref-123',
      },
      expect.anything(),
    );
  });

  /**
   * The anchor reconciles on this memo. Without one, a derived id is better
   * than none — but it has to fit Stellar's 28-byte MEMO_TEXT limit.
   */
  it('derives a memo-safe reference when the anchor names none', async () => {
    await resolveReturnTransaction(order({ anchorAccount: ANCHOR_ACCOUNT }), ADDRESS);

    const memo = vi.mocked(buildPaymentTx).mock.calls[0]![0].memo!;
    expect(memo).toBe('a1b2c3d4e5f67890abcdef12');
    expect(new TextEncoder().encode(memo).length).toBeLessThanOrEqual(28);
  });

  it('passes the caller’s network config through rather than assuming testnet', async () => {
    const config = {
      horizonUrl: 'https://horizon.example',
      networkPassphrase: 'Custom Passphrase',
    };
    await resolveReturnTransaction(order({ anchorAccount: ANCHOR_ACCOUNT }), ADDRESS, config);

    expect(vi.mocked(buildPaymentTx).mock.calls[0]![1]).toEqual(config);
  });

  it('sends the asset the order is selling, not the one it is buying', async () => {
    await resolveReturnTransaction(
      order({ anchorAccount: ANCHOR_ACCOUNT, sellAsset: USDC, sellAmount: '42.5' }),
      ADDRESS,
    );

    expect(vi.mocked(buildPaymentTx).mock.calls[0]![0]).toMatchObject({
      asset: USDC,
      amount: '42.5',
    });
  });
});

describe('orders with nothing to return', () => {
  it('refuses an on-ramp order — it has no return transaction', async () => {
    await expect(
      resolveReturnTransaction(order({ direction: 'onramp' }), ADDRESS),
    ).rejects.toMatchObject({ code: 'INVALID_ORDER_STATE', anchorId: 'etherfuse' });
  });

  /**
   * An anchor that gives neither is a broken integration, and saying so beats
   * handing the wallet an empty XDR.
   */
  it('reports an anchor that supplied neither, naming the order', async () => {
    await expect(resolveReturnTransaction(order(), ADDRESS)).rejects.toMatchObject({
      code: 'INVALID_ORDER_STATE',
      message: expect.stringContaining('a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
    });
  });

  it('names the anchor in that message, so the report is actionable', async () => {
    await expect(
      resolveReturnTransaction(order({ anchorName: 'Some Anchor' }), ADDRESS),
    ).rejects.toThrow(/Some Anchor/);
  });

  it('treats an empty XDR string as absent rather than signing nothing', async () => {
    await expect(
      resolveReturnTransaction(order({ unsignedTxXdr: '' }), ADDRESS),
    ).rejects.toMatchObject({ code: 'INVALID_ORDER_STATE' });
  });

  it('treats an empty anchor account as absent', async () => {
    await expect(
      resolveReturnTransaction(order({ anchorAccount: '' }), ADDRESS),
    ).rejects.toMatchObject({ code: 'INVALID_ORDER_STATE' });
  });
});
