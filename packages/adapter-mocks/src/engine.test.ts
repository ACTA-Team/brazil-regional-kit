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
