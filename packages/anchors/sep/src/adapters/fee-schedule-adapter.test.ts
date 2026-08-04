/**
 * The fee-schedule anchor adapter.
 *
 * This one quotes from terms an anchor actually publishes, so the thing worth
 * pinning is that it never invents a number: outside the published limits it
 * refuses, and without an issuer it declines the corridor rather than naming an
 * asset that does not exist.
 *
 * `fetchStellarToml` caches per domain for five minutes, so every test that
 * triggers discovery uses its own home domain. Sharing one would make these
 * pass or fail depending on execution order.
 */

import { describe, expect, it, vi } from 'vitest';
import { createSepFeeAdapter } from './fee-schedule-adapter';

const ISSUER = 'GCSGSR6KQQ5BP2FXVPWRL6SWPUSFWLVONLIBJZUKTVQB5FYJFVL6XOXE';
const MAINNET = 'Public Global Stellar Network ; September 2015';

const toml = (body: string) => body;

const MAINNET_TOML = `
NETWORK_PASSPHRASE = "${MAINNET}"
TRANSFER_SERVER_SEP0024 = "https://api.anchor.test/sep24"

[[CURRENCIES]]
code = "ARS"
issuer = "${ISSUER}"
`;

/** Anclap's real published ARS terms: 10 flat plus 1%, between 11 and 500000. */
const INFO = {
  deposit: {
    ARS: { enabled: true, min_amount: 11, max_amount: 500000, fee_fixed: 10, fee_percent: 1 },
  },
  withdraw: {
    ARS: { enabled: true, min_amount: 50, max_amount: 200000, fee_fixed: 5, fee_percent: 0.5 },
  },
};

let domainCounter = 0;
const freshDomain = () => `fee-anchor-${++domainCounter}.test`;

interface StubOptions {
  toml?: string;
  info?: unknown;
  infoStatus?: number;
  infoBody?: string;
}

/** Serves the TOML and the transfer server's `/info`, and counts the calls. */
function stubAnchor(options: StubOptions = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes('stellar.toml')) {
      return new Response(options.toml ?? MAINNET_TOML);
    }
    if (url.includes('/info')) {
      if (options.infoBody !== undefined) {
        return new Response(options.infoBody, { status: options.infoStatus ?? 200 });
      }
      return new Response(JSON.stringify(options.info ?? INFO), {
        status: options.infoStatus ?? 200,
      });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

const adapterWith = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) =>
  createSepFeeAdapter({
    mode: 'live',
    homeDomain: freshDomain(),
    id: 'anclap',
    name: 'Anclap',
    country: 'AR',
    rail: 'CBU',
    fetchImpl,
    ...extra,
  });

describe('discovery', () => {
  /**
   * The adapter takes a `fetchImpl` so the suite stays hermetic. If `/info` is
   * fetched through the global instead, this test reaches a real anchor over
   * the network — which is exactly what a unit suite must never do.
   */
  it('fetches /info through the injected fetch, not the global one', async () => {
    const fetchImpl = stubAnchor();
    await adapterWith(fetchImpl).discover();

    const urls = vi.mocked(fetchImpl).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/info'))).toBe(true);
  });

  it('derives a corridor in each direction from the published schedule', async () => {
    const adapter = adapterWith(stubAnchor());
    await adapter.discover();

    const corridors = adapter.capabilities().corridors;
    expect(corridors).toHaveLength(2);
    expect(corridors).toContainEqual({
      direction: 'onramp',
      sellAsset: 'iso4217:ARS',
      buyAsset: `stellar:ARS:${ISSUER}`,
      country: 'AR',
      rail: 'CBU',
      min: '11',
      max: '500000',
    });
    expect(corridors).toContainEqual({
      direction: 'offramp',
      sellAsset: `stellar:ARS:${ISSUER}`,
      buyAsset: 'iso4217:ARS',
      country: 'AR',
      rail: 'CBU',
      min: '50',
      max: '200000',
    });
  });

  /**
   * Most of these anchors are on mainnet, so a testnet app can read their real
   * prices but cannot settle against them. Hiding that is lying by omission.
   */
  it('reports the anchor’s network, so a testnet app knows it cannot settle', async () => {
    const adapter = adapterWith(stubAnchor());
    await adapter.discover();

    expect(adapter.capabilities().network).toBe('mainnet');
  });

  it('reports testnet when the anchor says so', async () => {
    const adapter = adapterWith(
      stubAnchor({
        toml: toml(`
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
TRANSFER_SERVER_SEP0024 = "https://api.anchor.test/sep24"

[[CURRENCIES]]
code = "ARS"
issuer = "${ISSUER}"
`),
      }),
    );
    await adapter.discover();

    expect(adapter.capabilities().network).toBe('testnet');
  });

  /** Published terms are not a reserved price, and orders need the anchor's own KYC. */
  it('advertises indicative quotes and no ordering', async () => {
    const adapter = adapterWith(stubAnchor());
    await adapter.discover();

    const features = adapter.capabilities().features;
    expect(features.firmQuotes).toBe(false);
    expect(features.orders).toBe(false);
    expect(features.interactive).toBe(true);
  });

  it('reads the TOML and /info once, then reuses them', async () => {
    const fetchImpl = stubAnchor();
    const adapter = adapterWith(fetchImpl);

    await adapter.discover();
    await adapter.discover();

    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight discovery between concurrent callers', async () => {
    const fetchImpl = stubAnchor();
    const adapter = adapterWith(fetchImpl);

    await Promise.all([adapter.discover(), adapter.discover(), adapter.discover()]);

    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);
  });

  it('falls back to the SEP-6 transfer server when there is no SEP-24 one', async () => {
    const adapter = adapterWith(
      stubAnchor({
        toml: toml(`
NETWORK_PASSPHRASE = "${MAINNET}"
TRANSFER_SERVER = "https://api.anchor.test/sep6"

[[CURRENCIES]]
code = "ARS"
issuer = "${ISSUER}"
`),
      }),
    );

    await expect(adapter.discover()).resolves.toBeTruthy();
    expect(adapter.capabilities().features.interactive).toBe(false);
  });

  it('reports an anchor with no transfer server as an unsupported pair', async () => {
    const adapter = adapterWith(stubAnchor({ toml: `NETWORK_PASSPHRASE = "${MAINNET}"` }));

    await expect(adapter.discover()).rejects.toMatchObject({
      code: 'UNSUPPORTED_PAIR',
      anchorId: 'anclap',
    });
  });

  it('reports an anchor whose /info is unusable as unavailable', async () => {
    const adapter = adapterWith(stubAnchor({ infoStatus: 503, infoBody: 'gateway down' }));

    await expect(adapter.discover()).rejects.toMatchObject({
      code: 'ANCHOR_UNAVAILABLE',
      anchorId: 'anclap',
    });
  });

  /** Without an issuer there is no asset to name, so the corridor is dropped. */
  it('skips an asset the anchor lists but does not issue', async () => {
    const adapter = adapterWith(
      stubAnchor({
        info: {
          deposit: { ARS: { enabled: true }, BRL: { enabled: true } },
          withdraw: {},
        },
      }),
    );
    await adapter.discover();

    const corridors = adapter.capabilities().corridors;
    expect(corridors).toHaveLength(1);
    expect(corridors[0]?.sellAsset).toBe('iso4217:ARS');
  });
});

describe('quoting', () => {
  const quote = (fetchImpl: typeof fetch, sellAmount = '1000') =>
    adapterWith(fetchImpl).getQuote({
      sellAsset: 'iso4217:ARS',
      buyAsset: `stellar:ARS:${ISSUER}`,
      sellAmount,
    });

  it('applies the anchor’s published fee to a deposit', async () => {
    // 1000 ARS: 10 flat + 1% = 20 fee, so 980 arrives.
    const result = await quote(stubAnchor());

    expect(result.buyAmount).toBe('980.0000000');
    expect(result.fee.amount).toBe('20.0000000');
    expect(result.fee.asset).toBe('iso4217:ARS');
    expect(result.direction).toBe('onramp');
  });

  /** The asset is pegged, so the fee is the entire spread. */
  it('reports the effective rate after the fee', async () => {
    expect((await quote(stubAnchor())).price).toBe('0.9800000');
  });

  it('marks the quote indicative, never firm', async () => {
    expect((await quote(stubAnchor())).firmness).toBe('indicative');
  });

  it('uses the withdraw side of the schedule for an off-ramp', async () => {
    // 1000 ARS out: 5 flat + 0.5% = 10 fee, so 990 arrives.
    const result = await adapterWith(stubAnchor()).getQuote({
      sellAsset: `stellar:ARS:${ISSUER}`,
      buyAsset: 'iso4217:ARS',
      sellAmount: '1000',
    });

    expect(result.direction).toBe('offramp');
    expect(result.buyAmount).toBe('990.0000000');
    expect(result.fee.amount).toBe('10.0000000');
  });

  /**
   * Quoting a size the anchor would reject is worse than saying it does not
   * serve it — the user acts on the quote and the order fails at the anchor.
   */
  it('refuses an amount below the published minimum', async () => {
    await expect(quote(stubAnchor(), '5')).rejects.toMatchObject({
      code: 'AMOUNT_OUT_OF_RANGE',
      anchorId: 'anclap',
    });
  });

  it('refuses an amount above the published maximum', async () => {
    await expect(quote(stubAnchor(), '500001')).rejects.toMatchObject({
      code: 'AMOUNT_OUT_OF_RANGE',
    });
  });

  it('names the accepted range when it refuses', async () => {
    await expect(quote(stubAnchor(), '5')).rejects.toThrow(/11.*500000/);
  });

  it('refuses a corridor it does not serve', async () => {
    await expect(
      adapterWith(stubAnchor()).getQuote({
        sellAsset: 'iso4217:BRL',
        buyAsset: `stellar:ARS:${ISSUER}`,
        sellAmount: '1000',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAIR', anchorId: 'anclap' });
  });

  it('refuses to quote without a sell amount', async () => {
    await expect(
      adapterWith(stubAnchor()).getQuote({
        sellAsset: 'iso4217:ARS',
        buyAsset: `stellar:ARS:${ISSUER}`,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAIR' });
  });

  /** The router needs to know which anchor failed to mark it in the table. */
  it('tags a discovery failure with the anchor id', async () => {
    await expect(
      adapterWith(stubAnchor({ infoStatus: 500, infoBody: 'nope' })).getQuote({
        sellAsset: 'iso4217:ARS',
        buyAsset: `stellar:ARS:${ISSUER}`,
        sellAmount: '1000',
      }),
    ).rejects.toMatchObject({ code: 'ANCHOR_UNAVAILABLE', anchorId: 'anclap' });
  });
});

describe('operations it deliberately does not implement', () => {
  it('refuses to create an order and explains what ordering would need', async () => {
    await expect(
      adapterWith(stubAnchor()).createOrder({ quoteId: 'q', account: 'GABC' }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_PAIR',
      message: expect.stringMatching(/SEP-10/i),
    });
  });

  it('refuses to read an order it never created', async () => {
    await expect(adapterWith(stubAnchor()).getOrder('order-1')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});
