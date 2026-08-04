/**
 * The generic SEP anchor adapter. Its value is that a second anchor costs a
 * config change rather than an integration, so what matters here is that
 * discovery, corridor derivation and quote normalization hold for an anchor
 * nobody wrote special-case code for.
 *
 * `fetchStellarToml` caches per domain for five minutes, so every test that
 * triggers discovery uses its own home domain. Sharing one would make these
 * pass or fail depending on the order they ran in.
 */

import { describe, expect, it, vi } from 'vitest';
import { BRL, USDC } from '@brk/ramp-core';
import { DEFAULT_HOME_DOMAIN, createSepAdapter, deriveCorridors } from './sep38-adapter';

const TOML = `
SIGNING_KEY = "GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR"
WEB_AUTH_ENDPOINT = "https://anchor.test/auth"
ANCHOR_QUOTE_SERVER = "https://anchor.test/sep38"
TRANSFER_SERVER_SEP0024 = "https://anchor.test/sep24"
`;

const INFO = {
  assets: [
    {
      asset: BRL,
      country_codes: ['BR'],
      sell_delivery_methods: [{ name: 'PIX' }],
      buy_delivery_methods: [{ name: 'PIX' }],
    },
    { asset: USDC },
  ],
};

const PRICE = {
  price: '0.18',
  total_price: '0.2',
  sell_amount: '500',
  buy_amount: '2500',
  fee: { total: '5', asset: BRL, details: [{ name: 'PIX fee', amount: '5' }] },
};

let domainCounter = 0;
/** A home domain nobody else in this file uses, so the TOML cache cannot leak. */
const freshDomain = () => `anchor-${++domainCounter}.test`;

interface StubOptions {
  toml?: string;
  tomlStatus?: number;
  info?: unknown;
  price?: unknown;
  priceStatus?: number;
}

/** Serves the TOML, `/info` and `/price` an anchor would, and counts the calls. */
function stubAnchor(options: StubOptions = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes('stellar.toml')) {
      return new Response(options.toml ?? TOML, { status: options.tomlStatus ?? 200 });
    }
    if (url.includes('/info')) {
      return new Response(JSON.stringify(options.info ?? INFO));
    }
    if (url.includes('/price')) {
      return new Response(JSON.stringify(options.price ?? PRICE), {
        status: options.priceStatus ?? 200,
      });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

const adapterWith = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) =>
  createSepAdapter({ mode: 'live', homeDomain: freshDomain(), fetchImpl, ...extra });

describe('corridor derivation', () => {
  /**
   * SEP-38 lists assets, not pairs. A client has to infer that a fiat and an
   * on-chain asset served by the same anchor are tradeable in both directions.
   */
  it('pairs every fiat with every on-chain asset, both ways', () => {
    const corridors = deriveCorridors({
      assets: [{ asset: BRL, country_codes: ['BR'] }, { asset: USDC }, { asset: 'stellar:native' }],
    });

    expect(corridors).toHaveLength(4);
    expect(corridors.filter((c) => c.direction === 'onramp')).toHaveLength(2);
    expect(corridors.filter((c) => c.direction === 'offramp')).toHaveLength(2);
    expect(corridors).toContainEqual({
      direction: 'onramp',
      sellAsset: BRL,
      buyAsset: USDC,
      country: 'BR',
      rail: 'bank',
    });
  });

  it('carries the anchor’s declared delivery methods as the rail', () => {
    const corridors = deriveCorridors({
      assets: [
        {
          asset: BRL,
          country_codes: ['BR'],
          sell_delivery_methods: [{ name: 'PIX' }],
          buy_delivery_methods: [{ name: 'TED' }],
        },
        { asset: USDC },
      ],
    });

    expect(corridors.find((c) => c.direction === 'onramp')?.rail).toBe('PIX');
    expect(corridors.find((c) => c.direction === 'offramp')?.rail).toBe('TED');
  });

  it('falls back to the configured country when the anchor declares none', () => {
    const corridors = deriveCorridors({ assets: [{ asset: BRL }, { asset: USDC }] }, 'BR');
    expect(corridors).toHaveLength(2);
    expect(corridors[0]?.country).toBe('BR');
  });

  /** A corridor with no country cannot be matched against a user's request. */
  it('drops a fiat with no country and no fallback rather than inventing one', () => {
    expect(deriveCorridors({ assets: [{ asset: BRL }, { asset: USDC }] })).toEqual([]);
  });

  it('produces nothing when the anchor serves only fiat or only crypto', () => {
    expect(deriveCorridors({ assets: [{ asset: BRL, country_codes: ['BR'] }] })).toEqual([]);
    expect(deriveCorridors({ assets: [{ asset: USDC }] })).toEqual([]);
  });

  it('survives an empty asset list', () => {
    expect(deriveCorridors({ assets: [] })).toEqual([]);
  });
});

describe('identity and capabilities', () => {
  it('defaults to SDF’s public test anchor, which needs no signup', () => {
    expect(createSepAdapter({ mode: 'live' }).id).toBe('testanchor');
    expect(DEFAULT_HOME_DOMAIN).toBe('testanchor.stellar.org');
  });

  it('derives an id from the home domain’s first label', () => {
    expect(createSepAdapter({ mode: 'live', homeDomain: 'ramp.example.com' }).id).toBe('ramp');
  });

  it('prefers an explicit id and name', () => {
    const adapter = createSepAdapter({ mode: 'live', id: 'custom', name: 'Custom Anchor' });
    expect(adapter.id).toBe('custom');
    expect(adapter.capabilities().name).toBe('Custom Anchor');
  });

  it('says quotes are live when the mode is live, and replayed when it is mock', () => {
    expect(createSepAdapter({ mode: 'live' }).capabilities().note).toMatch(/live sep-38/i);
    expect(createSepAdapter({ mode: 'mock' }).capabilities().note).toMatch(/recorded/i);
  });

  it('reports no corridors before discovery has run', () => {
    expect(createSepAdapter({ mode: 'live' }).capabilities().corridors).toEqual([]);
  });

  it('reports corridors and countries once discovery has run', async () => {
    const adapter = adapterWith(stubAnchor());
    await adapter.metadata();

    const caps = adapter.capabilities();
    expect(caps.countries).toEqual(['BR']);
    expect(caps.corridors).toHaveLength(2);
    expect(caps.features.interactive).toBe(true);
    expect(caps.features.firmQuotes).toBe(true);
    expect(caps.features.orders).toBe(false);
  });

  it('reports interactive as false when the anchor advertises no SEP-24 server', async () => {
    const adapter = adapterWith(stubAnchor({ toml: 'ANCHOR_QUOTE_SERVER = "https://a.test/s38"' }));
    await adapter.metadata();

    expect(adapter.capabilities().features.interactive).toBe(false);
  });
});

describe('discovery', () => {
  it('reads the TOML and /info exactly once, then reuses them', async () => {
    const fetchImpl = stubAnchor();
    const adapter = adapterWith(fetchImpl);

    await adapter.metadata();
    await adapter.metadata();

    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);
  });

  /** Two pages mounting at once must not fire two discoveries. */
  it('shares one in-flight discovery between concurrent callers', async () => {
    const fetchImpl = stubAnchor();
    const adapter = adapterWith(fetchImpl);

    await Promise.all([adapter.metadata(), adapter.metadata(), adapter.metadata()]);

    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);
  });

  it('reports an anchor without ANCHOR_QUOTE_SERVER as an unsupported pair, not a crash', async () => {
    const adapter = adapterWith(stubAnchor({ toml: 'SIGNING_KEY = "G..."' }));

    await expect(adapter.metadata()).rejects.toMatchObject({ code: 'UNSUPPORTED_PAIR' });
  });

  it('surfaces an unreachable TOML as ANCHOR_UNAVAILABLE', async () => {
    const adapter = adapterWith(stubAnchor({ tomlStatus: 503 }));

    await expect(adapter.metadata()).rejects.toMatchObject({ code: 'ANCHOR_UNAVAILABLE' });
  });

  /** A failed discovery must not be cached as a success. */
  it('retries discovery after a failure instead of caching the error', async () => {
    let ok = false;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('stellar.toml')) {
        return ok ? new Response(TOML) : new Response('', { status: 500 });
      }
      return new Response(JSON.stringify(INFO));
    }) as unknown as typeof fetch;

    const adapter = adapterWith(fetchImpl);
    await expect(adapter.metadata()).rejects.toMatchObject({ code: 'ANCHOR_UNAVAILABLE' });

    ok = true;
    await expect(adapter.metadata()).resolves.toMatchObject({ info: INFO });
  });
});

describe('quoting', () => {
  it('normalizes a SEP-38 price into the kit’s Quote shape', async () => {
    const quote = await adapterWith(stubAnchor()).getQuote({
      sellAsset: BRL,
      buyAsset: USDC,
      sellAmount: '500',
    });

    expect(quote).toMatchObject({
      sellAsset: BRL,
      buyAsset: USDC,
      sellAmount: '500',
      buyAmount: '2500',
      firmness: 'indicative',
      mode: 'live',
    });
    expect(quote.fee).toMatchObject({ amount: '5', asset: BRL });
    expect(quote.fee.detail).toEqual([{ name: 'PIX fee', amount: '5' }]);
  });

  /**
   * `total_price` is sell-per-buy and includes fees; the kit reports
   * buy-per-sell everywhere. Getting this backwards makes a good anchor look
   * five times worse than it is in the router table.
   */
  it('inverts total_price so the rate reads as buy units per sell unit', async () => {
    const quote = await adapterWith(stubAnchor()).getQuote({
      sellAsset: BRL,
      buyAsset: USDC,
      sellAmount: '500',
    });

    expect(quote.price).toBe('5');
  });

  it('falls back to buy÷sell when the anchor reports a zero total_price', async () => {
    const quote = await adapterWith(stubAnchor({ price: { ...PRICE, total_price: '0' } })).getQuote(
      { sellAsset: BRL, buyAsset: USDC, sellAmount: '500' },
    );

    expect(quote.price).toBe('5');
  });

  it('reports a rate of zero rather than throwing on unusable numbers', async () => {
    const quote = await adapterWith(
      stubAnchor({
        price: { ...PRICE, total_price: 'n/a', buy_amount: 'n/a', sell_amount: 'n/a' },
      }),
    ).getQuote({ sellAsset: BRL, buyAsset: USDC, sellAmount: '500' });

    expect(quote.price).toBe('0');
  });

  it('calls selling fiat an on-ramp and selling an on-chain asset an off-ramp', async () => {
    const onramp = await adapterWith(stubAnchor()).getQuote({
      sellAsset: BRL,
      buyAsset: USDC,
      sellAmount: '500',
    });
    const offramp = await adapterWith(stubAnchor()).getQuote({
      sellAsset: USDC,
      buyAsset: BRL,
      sellAmount: '100',
    });

    expect(onramp.direction).toBe('onramp');
    expect(offramp.direction).toBe('offramp');
  });

  it('marks an indicative quote as short-lived so the UI re-quotes', async () => {
    const quote = await adapterWith(stubAnchor()).getQuote({
      sellAsset: BRL,
      buyAsset: USDC,
      sellAmount: '500',
    });

    const ttl = new Date(quote.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('sends the delivery methods discovered from /info', async () => {
    const fetchImpl = stubAnchor();
    await adapterWith(fetchImpl).getQuote({ sellAsset: BRL, buyAsset: USDC, sellAmount: '500' });

    const priceCall = vi
      .mocked(fetchImpl)
      .mock.calls.map((c) => String(c[0]))
      .find((u) => u.includes('/price'));
    const params = new URL(priceCall!).searchParams;

    expect(params.get('sell_delivery_method')).toBe('PIX');
    expect(params.get('country_code')).toBe('BR');
  });

  it('prefers the country the caller asked for over the anchor’s default', async () => {
    const fetchImpl = stubAnchor();
    await adapterWith(fetchImpl).getQuote({
      sellAsset: BRL,
      buyAsset: USDC,
      sellAmount: '500',
      country: 'MX',
    });

    const priceCall = vi
      .mocked(fetchImpl)
      .mock.calls.map((c) => String(c[0]))
      .find((u) => u.includes('/price'));

    expect(new URL(priceCall!).searchParams.get('country_code')).toBe('MX');
  });

  it('refuses to quote without a sell amount', async () => {
    await expect(
      adapterWith(stubAnchor()).getQuote({ sellAsset: BRL, buyAsset: USDC }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('does not even reach the anchor when the request is unusable', async () => {
    const fetchImpl = stubAnchor();
    await expect(
      adapterWith(fetchImpl).getQuote({ sellAsset: BRL, buyAsset: USDC }),
    ).rejects.toThrow();

    expect(vi.mocked(fetchImpl)).not.toHaveBeenCalled();
  });

  /** The router needs to know which anchor failed to mark it in the table. */
  it('tags a pricing failure with the anchor id', async () => {
    const adapter = createSepAdapter({
      mode: 'live',
      homeDomain: freshDomain(),
      id: 'my-anchor',
      fetchImpl: stubAnchor({ price: { error: 'Unsupported asset pair' }, priceStatus: 400 }),
    });

    await expect(
      adapter.getQuote({ sellAsset: BRL, buyAsset: USDC, sellAmount: '500' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAIR', anchorId: 'my-anchor' });
  });
});

describe('operations this adapter deliberately does not implement', () => {
  /**
   * Half-implementing SEP-6 deposits would fail at the KYC step with an opaque
   * error. Failing here instead points at the flow that actually works.
   */
  it('refuses to create an order and names the supported path', async () => {
    await expect(
      createSepAdapter({ mode: 'live' }).createOrder({
        quoteId: 'q',
        account: 'GABC',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: expect.stringMatching(/SEP-24/i) });
  });

  it('refuses to read an order it never created', async () => {
    await expect(createSepAdapter({ mode: 'live' }).getOrder('order-1')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});

describe('interactive handoff', () => {
  it('resolves a deposit URL when selling fiat', async () => {
    await expect(
      adapterWith(stubAnchor()).getInteractiveUrl({
        sellAsset: BRL,
        buyAsset: USDC,
        sellAmount: '500',
      }),
    ).resolves.toBe('https://anchor.test/sep24/transactions/deposit/interactive');
  });

  it('resolves a withdraw URL when selling an on-chain asset', async () => {
    await expect(
      adapterWith(stubAnchor()).getInteractiveUrl({
        sellAsset: USDC,
        buyAsset: BRL,
        sellAmount: '100',
      }),
    ).resolves.toBe('https://anchor.test/sep24/transactions/withdraw/interactive');
  });

  it('reports plainly when the anchor advertises no SEP-24 server', async () => {
    const adapter = adapterWith(stubAnchor({ toml: 'ANCHOR_QUOTE_SERVER = "https://a.test/s38"' }));

    await expect(
      adapter.getInteractiveUrl({ sellAsset: BRL, buyAsset: USDC, sellAmount: '500' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
