import { describe, expect, it } from 'vitest';
import {
  BRL,
  MXN,
  RampError,
  USDC,
  type AdapterCapabilities,
  type CreateOrderRequest,
  type Order,
  type Quote,
  type QuoteRequest,
  type RampAdapter,
} from '@brk/ramp-core';
import { createRampRouter, rank } from './router';

/** A minimal adapter that answers exactly how a test tells it to. */
function stub(options: {
  id: string;
  mode?: 'live' | 'mock';
  buyAsset: string;
  payout: string;
  latencyMs?: number;
  firmness?: 'firm' | 'indicative';
  fail?: RampError;
  hang?: boolean;
}): RampAdapter {
  const caps: AdapterCapabilities = {
    id: options.id,
    name: options.id,
    mode: options.mode ?? 'mock',
    countries: ['BR'],
    corridors: [
      {
        direction: 'onramp',
        sellAsset: BRL,
        buyAsset: options.buyAsset,
        country: 'BR',
        rail: 'PIX',
      },
    ],
    features: { firmQuotes: true, orders: true, sandboxSimulation: false, interactive: false },
  };

  return {
    capabilities: () => caps,
    async getQuote(req: QuoteRequest): Promise<Quote> {
      if (options.hang) await new Promise(() => {});
      if (options.fail) throw options.fail;
      await new Promise((r) => setTimeout(r, options.latencyMs ?? 0));
      return {
        id: `${options.id}-q`,
        anchorId: options.id,
        anchorName: options.id,
        mode: caps.mode,
        direction: 'onramp',
        sellAsset: req.sellAsset,
        buyAsset: options.buyAsset,
        sellAmount: req.sellAmount ?? '0',
        buyAmount: options.payout,
        price: '1',
        fee: { amount: '0', asset: req.sellAsset },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        latencyMs: options.latencyMs ?? 0,
        firmness: options.firmness ?? 'firm',
      };
    },
    createOrder: (_req: CreateOrderRequest) => Promise.reject(new Error('not used')),
    getOrder: (_id: string) => Promise.reject<Order>(new Error('not used')),
  };
}

describe('candidate selection', () => {
  it('asks only the anchors that serve an exact pair', async () => {
    const router = createRampRouter({
      adapters: [
        stub({ id: 'a', buyAsset: USDC, payout: '100' }),
        stub({ id: 'b', buyAsset: MXN, payout: '1700' }),
      ],
    });

    const result = await router.route({ sellAsset: BRL, buyAsset: USDC, sellAmount: '500' });
    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0]?.anchorId).toBe('a');
  });

  /** The open question — "what can I get here?" — is what makes it a router. */
  it('asks every destination when no buyAsset is given', async () => {
    const router = createRampRouter({
      adapters: [
        stub({ id: 'a', buyAsset: USDC, payout: '100' }),
        stub({ id: 'b', buyAsset: MXN, payout: '1700' }),
      ],
    });

    const result = await router.route({ sellAsset: BRL, sellAmount: '500', country: 'BR' });
    expect(result.quotes.map((q) => q.anchorId).sort()).toEqual(['a', 'b']);
  });

  it('filters by country', async () => {
    const router = createRampRouter({ adapters: [stub({ id: 'a', buyAsset: USDC, payout: '1' })] });
    const result = await router.route({ sellAsset: BRL, sellAmount: '500', country: 'MX' });
    expect(result.quotes).toHaveLength(0);
  });
});

describe('failure reporting', () => {
  it('reports a failing anchor instead of dropping it silently', async () => {
    const router = createRampRouter({
      adapters: [
        stub({ id: 'ok', buyAsset: USDC, payout: '100' }),
        stub({
          id: 'broken',
          buyAsset: USDC,
          payout: '0',
          fail: new RampError({ code: 'ANCHOR_UNAVAILABLE', message: 'boom' }),
        }),
      ],
    });

    const result = await router.route({ sellAsset: BRL, buyAsset: USDC, sellAmount: '500' });
    expect(result.quotes).toHaveLength(1);

    const broken = result.anchors.find((a) => a.anchorId === 'broken');
    expect(broken).toMatchObject({ outcome: 'failed', errorCode: 'ANCHOR_UNAVAILABLE' });
    expect(broken?.reason).toBe('boom');
  });

  it('classifies an unsupported pair separately from an error', async () => {
    const router = createRampRouter({
      adapters: [
        stub({
          id: 'narrow',
          buyAsset: USDC,
          payout: '0',
          fail: new RampError({ code: 'UNSUPPORTED_PAIR', message: 'nope' }),
        }),
      ],
    });

    const result = await router.route({ sellAsset: BRL, buyAsset: USDC, sellAmount: '500' });
    expect(result.anchors[0]?.outcome).toBe('unsupported');
  });

  /** One hung anchor must cost its own timeout, not the whole response. */
  it('times a hung anchor out without blocking the others', async () => {
    const router = createRampRouter({
      adapters: [
        stub({ id: 'fast', buyAsset: USDC, payout: '100' }),
        stub({ id: 'hung', buyAsset: USDC, payout: '0', hang: true }),
      ],
      defaultTimeoutMs: 60,
    });

    const started = Date.now();
    const result = await router.route({ sellAsset: BRL, buyAsset: USDC, sellAmount: '500' });
    const elapsed = Date.now() - started;

    expect(result.quotes).toHaveLength(1);
    expect(result.anchors.find((a) => a.anchorId === 'hung')?.outcome).toBe('timeout');
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe('ranking', () => {
  const quote = (
    over: Partial<Quote> & Pick<Quote, 'anchorId' | 'buyAsset' | 'buyAmount'>,
  ): Quote => ({
    id: `${over.anchorId}-q`,
    anchorName: over.anchorId,
    mode: 'mock',
    direction: 'onramp',
    sellAsset: BRL,
    sellAmount: '500',
    price: '1',
    fee: { amount: '0', asset: BRL },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    latencyMs: 100,
    firmness: 'firm',
    ...over,
  });

  it('orders by what the user receives', () => {
    const ranked = rank([
      quote({ anchorId: 'low', buyAsset: USDC, buyAmount: '90' }),
      quote({ anchorId: 'high', buyAsset: USDC, buyAmount: '95' }),
    ]);

    expect(ranked[0]).toMatchObject({ anchorId: 'high', best: true, rank: 1, groupSize: 2 });
    expect(ranked[1]).toMatchObject({ anchorId: 'low', best: false, rank: 2 });
    expect(ranked[1]?.worseByPct).toBe('5.26');
  });

  /**
   * "Best MXN" and "best BRL" are different questions; a single winner across
   * currencies would be meaningless.
   */
  it('ranks within a destination asset, not across them', () => {
    const ranked = rank([
      quote({ anchorId: 'brl', buyAsset: BRL, buyAmount: '500' }),
      quote({ anchorId: 'mxn', buyAsset: MXN, buyAmount: '1700' }),
    ]);

    expect(ranked.every((q) => q.best)).toBe(true);
    expect(ranked.every((q) => q.groupSize === 1)).toBe(true);
  });

  it('breaks a tie by firmness, then by latency', () => {
    const ranked = rank([
      quote({ anchorId: 'slow-firm', buyAsset: USDC, buyAmount: '90', latencyMs: 500 }),
      quote({
        anchorId: 'indicative',
        buyAsset: USDC,
        buyAmount: '90',
        firmness: 'indicative',
        latencyMs: 10,
      }),
    ]);
    expect(ranked[0]?.anchorId).toBe('slow-firm');
  });

  it('puts live quotes ahead of simulated ones', () => {
    const ranked = rank([
      quote({ anchorId: 'mock', buyAsset: MXN, buyAmount: '9999' }),
      quote({ anchorId: 'live', buyAsset: USDC, buyAmount: '1', mode: 'live' }),
    ]);
    expect(ranked[0]?.anchorId).toBe('live');
  });
});

describe('result metadata', () => {
  it('flags whether anything real is in the answer', async () => {
    const mockOnly = createRampRouter({
      adapters: [stub({ id: 'm', buyAsset: USDC, payout: '1' })],
    });
    const withLive = createRampRouter({
      adapters: [stub({ id: 'l', buyAsset: USDC, payout: '1', mode: 'live' })],
    });

    expect((await mockOnly.route({ sellAsset: BRL, sellAmount: '500' })).hasLiveQuote).toBe(false);
    expect((await withLive.route({ sellAsset: BRL, sellAmount: '500' })).hasLiveQuote).toBe(true);
  });

  it('exposes the best quote for a pair directly', async () => {
    const router = createRampRouter({
      adapters: [
        stub({ id: 'low', buyAsset: USDC, payout: '90' }),
        stub({ id: 'high', buyAsset: USDC, payout: '95' }),
      ],
    });

    const best = await router.best({ sellAsset: BRL, buyAsset: USDC, sellAmount: '500' });
    expect(best?.anchorId).toBe('high');
  });
});
