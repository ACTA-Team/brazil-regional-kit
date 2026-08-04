import { describe, expect, it } from 'vitest';
import { BRL, MXN, USDC, fiat } from '@brk/ramp-core';
import { createAllMockAdapters, createKoyweAdapter, createMantecaAdapter } from './index';

const instant = { instant: true } as const;

describe('honesty', () => {
  /**
   * The single most important property of this package. If a simulated anchor
   * could ever report `live`, the badge in the UI would be a lie and every
   * genuinely live quote next to it would become untrustworthy too.
   */
  it('always reports mock mode', () => {
    for (const adapter of createAllMockAdapters(instant)) {
      expect(adapter.capabilities().mode).toBe('mock');
    }
  });

  it('carries mock mode onto every quote', async () => {
    const quote = await createMantecaAdapter(instant).getQuote({
      sellAsset: BRL,
      buyAsset: USDC,
      sellAmount: '500',
    });
    expect(quote.mode).toBe('mock');
    expect(quote.firmness).toBe('indicative');
  });

  it('explains in its capabilities why it is simulated', () => {
    expect(createMantecaAdapter(instant).capabilities().note).toMatch(/commercial onboarding/i);
    expect(createKoyweAdapter(instant).capabilities().note).toMatch(/not yet in Brazil/i);
  });
});

describe('corridors', () => {
  it('models Manteca in Brazil and Argentina', () => {
    const caps = createMantecaAdapter(instant).capabilities();
    expect(caps.countries.sort()).toEqual(['AR', 'BR']);
    expect(caps.corridors.some((c) => c.sellAsset === BRL && c.buyAsset === USDC)).toBe(true);
    expect(caps.corridors.some((c) => c.rail === 'PIX')).toBe(true);
  });

  it('models Koywe across its live markets, without Brazil', () => {
    const caps = createKoyweAdapter(instant).capabilities();
    expect(caps.countries).toContain('MX');
    expect(caps.countries).not.toContain('BR');
    expect(caps.corridors.some((c) => c.buyAsset === MXN && c.rail === 'SPEI')).toBe(true);
  });
});

describe('quoting', () => {
  it('prices an off-ramp to pesos', async () => {
    const quote = await createKoyweAdapter(instant).getQuote({
      sellAsset: USDC,
      buyAsset: MXN,
      sellAmount: '100',
    });

    expect(quote.direction).toBe('offramp');
    expect(Number(quote.buyAmount)).toBeGreaterThan(1_000);
    expect(Number(quote.fee.amount)).toBeGreaterThan(0);
    expect(new Date(quote.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('moves between requests so the UI is not showing a frozen number', async () => {
    const adapter = createKoyweAdapter(instant);
    const seen = new Set<string>();
    for (const amount of ['100', '101', '102', '103']) {
      const quote = await adapter.getQuote({ sellAsset: USDC, buyAsset: MXN, sellAmount: amount });
      seen.add(quote.price);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('rejects a corridor it does not serve', async () => {
    await expect(
      createKoyweAdapter(instant).getQuote({
        sellAsset: BRL,
        buyAsset: USDC,
        sellAmount: '500',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAIR' });
  });

  it('enforces its stated limits', async () => {
    const adapter = createMantecaAdapter(instant);
    await expect(
      adapter.getQuote({ sellAsset: BRL, buyAsset: USDC, sellAmount: '1' }),
    ).rejects.toMatchObject({ code: 'AMOUNT_OUT_OF_RANGE' });
    await expect(
      adapter.getQuote({ sellAsset: BRL, buyAsset: USDC, sellAmount: '999999' }),
    ).rejects.toMatchObject({ code: 'AMOUNT_OUT_OF_RANGE' });
  });

  it('requires a sell amount', async () => {
    await expect(
      createMantecaAdapter(instant).getQuote({ sellAsset: BRL, buyAsset: USDC }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('does not model currencies it has no corridor for', async () => {
    await expect(
      createMantecaAdapter(instant).getQuote({
        sellAsset: fiat('COP'),
        buyAsset: USDC,
        sellAmount: '100000',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAIR' });
  });
});

/**
 * The order store is keyed on `globalThis`, so every test below uses its own
 * order id. Sharing one would make these pass or fail by execution order.
 */
describe('order lifecycle', () => {
  let seq = 0;
  const freshId = () => `test-order-${Date.now()}-${++seq}`;

  const newOrder = async (orderId: string, settlementMs = 0) => {
    const adapter = createMantecaAdapter({ instant: true, settlementMs });
    const order = await adapter.createOrder({
      orderId,
      quoteId: 'manteca-1700000000000-500',
      account: 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4',
    });
    return { adapter, order };
  };

  it('creates an order waiting on the user’s payment', async () => {
    const { order } = await newOrder(freshId());

    expect(order.status).toBe('awaiting_payment');
    expect(order.mode).toBe('mock');
    expect(order.direction).toBe('onramp');
    expect(order.history).toEqual([{ status: 'created', at: expect.any(String) }]);
  });

  /** Quote ids encode the amount, so an order needs no server-side state. */
  it('recovers the amount from the quote id', async () => {
    const { order } = await newOrder(freshId());

    expect(order.sellAmount).toBe('500');
    expect(Number(order.buyAmount)).toBeGreaterThan(0);
  });

  it('honours the caller’s order id, and invents one otherwise', async () => {
    const id = freshId();
    expect((await newOrder(id)).order.id).toBe(id);

    const generated = await createMantecaAdapter(instant).createOrder({
      quoteId: 'manteca-1700000000000-500',
      account: 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4',
    });
    expect(generated.id).toMatch(/^manteca-order-\d+$/);
  });

  it('reads back an order it created', async () => {
    const id = freshId();
    const { adapter } = await newOrder(id);

    expect((await adapter.getOrder(id)).id).toBe(id);
  });

  it('reports an unknown order rather than inventing one', async () => {
    await expect(createMantecaAdapter(instant).getOrder('no-such-order')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      anchorId: 'manteca',
    });
  });

  it('moves to processing once the fiat leg is simulated', async () => {
    const id = freshId();
    const { adapter } = await newOrder(id, 60_000);

    const settled = await adapter.simulateFiatReceived(id);
    expect(settled.status).toBe('processing');
    expect(settled.history.map((h) => h.status)).toEqual(['created', 'processing']);
  });

  it('completes once the settlement window has passed', async () => {
    const id = freshId();
    const { adapter } = await newOrder(id, 0);

    await adapter.simulateFiatReceived(id);
    const done = await adapter.getOrder(id);

    expect(done.status).toBe('completed');
    expect(done.history.map((h) => h.status)).toEqual(['created', 'processing', 'completed']);
  });

  /** Polling is how the UI drives this, so repeated reads must not pile up history. */
  it('does not append a duplicate event when polled repeatedly', async () => {
    const id = freshId();
    const { adapter } = await newOrder(id, 0);

    await adapter.simulateFiatReceived(id);
    await adapter.getOrder(id);
    await adapter.getOrder(id);
    const final = await adapter.getOrder(id);

    expect(final.history.filter((h) => h.status === 'completed')).toHaveLength(1);
  });

  it('stays in processing until the window elapses', async () => {
    const id = freshId();
    const { adapter } = await newOrder(id, 60_000);

    await adapter.simulateFiatReceived(id);
    expect((await adapter.getOrder(id)).status).toBe('processing');
  });

  it('leaves an unsettled order alone', async () => {
    const id = freshId();
    const { adapter } = await newOrder(id);

    expect((await adapter.getOrder(id)).status).toBe('awaiting_payment');
  });

  it('settles the crypto leg the same way, for the off-ramp direction', async () => {
    const id = freshId();
    const adapter = createKoyweAdapter({ instant: true, settlementMs: 0 });
    await adapter.createOrder({
      orderId: id,
      quoteId: 'koywe-1700000000000-100',
      account: 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4',
    });

    expect((await adapter.simulateCryptoReceived(id)).status).toBe('processing');
    expect((await adapter.getOrder(id)).status).toBe('completed');
  });

  it('refuses to settle an order it never created', async () => {
    await expect(
      createMantecaAdapter(instant).simulateFiatReceived('no-such-order'),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
