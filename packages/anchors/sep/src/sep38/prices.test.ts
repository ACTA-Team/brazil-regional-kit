/**
 * SEP-38 is what makes the router possible: `/info`, `/prices` and `/price` are
 * unauthenticated, so live competing quotes need no key and no KYC. These tests
 * pin down that claim (no `Authorization` header is sent), the parameter
 * building, and — most importantly — the error classification, because the
 * router branches on it to decide "skip this anchor" vs "surface to the user".
 */

import { describe, expect, it, vi } from 'vitest';
import { BRL, USDC } from '@brk/ramp-core';
import { Sep38Client } from './prices';

const QUOTE_SERVER = 'https://anchor.test/sep38';

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    typeof body === 'string'
      ? new Response(body, { status })
      : new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

const client = (fetchImpl: typeof fetch, quoteServer = QUOTE_SERVER) =>
  new Sep38Client({ quoteServer, fetchImpl });

const urlOf = (fetchImpl: typeof fetch, call = 0) =>
  new URL(vi.mocked(fetchImpl).mock.calls[call]![0] as string);

const initOf = (fetchImpl: typeof fetch, call = 0) =>
  vi.mocked(fetchImpl).mock.calls[call]![1] as RequestInit;

describe('info', () => {
  it('reads the asset list', async () => {
    const fetchImpl = fetchReturning({ assets: [{ asset: USDC }, { asset: BRL }] });

    await expect(client(fetchImpl).info()).resolves.toEqual({
      assets: [{ asset: USDC }, { asset: BRL }],
    });
    expect(urlOf(fetchImpl).pathname).toBe('/sep38/info');
  });

  /** The whole argument for using SEP-38 in the router. If this regresses, the
   * router silently needs credentials it was designed not to need. */
  it('sends no Authorization header — these endpoints are unauthenticated', async () => {
    const fetchImpl = fetchReturning({ assets: [] });
    await client(fetchImpl).info();

    expect(initOf(fetchImpl).headers).toBeUndefined();
  });

  it('tolerates a trailing slash on the configured quote server', async () => {
    const fetchImpl = fetchReturning({ assets: [] });
    await client(fetchImpl, `${QUOTE_SERVER}//`).info();

    expect(urlOf(fetchImpl).pathname).toBe('/sep38/info');
  });

  it('appends no query string when there are no parameters', async () => {
    const fetchImpl = fetchReturning({ assets: [] });
    await client(fetchImpl).info();

    expect(vi.mocked(fetchImpl).mock.calls[0]![0]).toBe(`${QUOTE_SERVER}/info`);
  });
});

describe('prices', () => {
  it('sends the mandatory sell parameters', async () => {
    const fetchImpl = fetchReturning({ buy_assets: [] });
    await client(fetchImpl).prices({ sellAsset: BRL, sellAmount: '500' });

    const url = urlOf(fetchImpl);
    expect(url.pathname).toBe('/sep38/prices');
    expect(url.searchParams.get('sell_asset')).toBe(BRL);
    expect(url.searchParams.get('sell_amount')).toBe('500');
  });

  it('omits optional parameters the caller did not supply', async () => {
    const fetchImpl = fetchReturning({ buy_assets: [] });
    await client(fetchImpl).prices({ sellAsset: BRL, sellAmount: '500' });

    const url = urlOf(fetchImpl);
    expect(url.searchParams.has('sell_delivery_method')).toBe(false);
    expect(url.searchParams.has('buy_delivery_method')).toBe(false);
    expect(url.searchParams.has('country_code')).toBe(false);
  });

  it('forwards delivery methods and country when supplied', async () => {
    const fetchImpl = fetchReturning({ buy_assets: [] });
    await client(fetchImpl).prices({
      sellAsset: BRL,
      sellAmount: '500',
      sellDeliveryMethod: 'PIX',
      buyDeliveryMethod: 'crypto',
      countryCode: 'BR',
    });

    const url = urlOf(fetchImpl);
    expect(url.searchParams.get('sell_delivery_method')).toBe('PIX');
    expect(url.searchParams.get('buy_delivery_method')).toBe('crypto');
    expect(url.searchParams.get('country_code')).toBe('BR');
  });
});

describe('price', () => {
  const priceBody = {
    price: '0.18',
    total_price: '0.1782',
    sell_amount: '500',
    buy_amount: '89.1',
    fee: { total: '5', asset: BRL },
  };

  it('returns the anchor’s indicative price', async () => {
    await expect(
      client(fetchReturning(priceBody)).price({ sellAsset: BRL, buyAsset: USDC }),
    ).resolves.toMatchObject({ total_price: '0.1782', buy_amount: '89.1' });
  });

  it('defaults the SEP-38 context to sep6', async () => {
    const fetchImpl = fetchReturning(priceBody);
    await client(fetchImpl).price({ sellAsset: BRL, buyAsset: USDC });

    expect(urlOf(fetchImpl).searchParams.get('context')).toBe('sep6');
  });

  it('honours an explicit context', async () => {
    const fetchImpl = fetchReturning(priceBody);
    await client(fetchImpl).price({ sellAsset: BRL, buyAsset: USDC, context: 'sep31' });

    expect(urlOf(fetchImpl).searchParams.get('context')).toBe('sep31');
  });

  it('sends whichever side of the amount the caller pinned', async () => {
    const fetchImpl = fetchReturning(priceBody);
    await client(fetchImpl).price({ sellAsset: BRL, buyAsset: USDC, buyAmount: '100' });

    const url = urlOf(fetchImpl);
    expect(url.searchParams.get('buy_amount')).toBe('100');
    expect(url.searchParams.has('sell_amount')).toBe(false);
  });
});

describe('error classification', () => {
  const call = (body: unknown, status: number) =>
    client(fetchReturning(body, status)).price({ sellAsset: BRL, buyAsset: USDC });

  it('maps 401 to AUTH_FAILED', async () => {
    await expect(call({ error: 'unauthorized' }, 401)).rejects.toMatchObject({
      code: 'AUTH_FAILED',
      status: 401,
    });
  });

  it('maps 403 to AUTH_FAILED', async () => {
    await expect(call({ error: 'forbidden' }, 403)).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  /**
   * The distinction the router lives on: an unsupported corridor is a normal
   * answer to rank around, not an anchor that is broken.
   */
  it('maps a 400 that says the pair is unsupported to UNSUPPORTED_PAIR', async () => {
    await expect(call({ error: 'Unsupported asset pair' }, 400)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PAIR',
    });
    await expect(call({ error: 'sell_asset is not supported' }, 400)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PAIR',
    });
    await expect(call({ error: 'delivery method not available' }, 400)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PAIR',
    });
  });

  it('maps any other 400 to INVALID_REQUEST', async () => {
    await expect(call({ error: 'sell_amount must be positive' }, 400)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('maps 5xx to ANCHOR_UNAVAILABLE', async () => {
    await expect(call({ error: 'boom' }, 503)).rejects.toMatchObject({
      code: 'ANCHOR_UNAVAILABLE',
    });
  });

  it('maps an unclassified 4xx to INVALID_REQUEST', async () => {
    await expect(call({ error: 'teapot' }, 418)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('falls back to a descriptive message when the anchor sends no error field', async () => {
    await expect(call({}, 400)).rejects.toMatchObject({
      message: expect.stringContaining('/price returned 400'),
    });
  });

  /**
   * Anchors routinely answer an unserved corridor with an HTML error page. That
   * is a corridor problem, not a parse problem, and blaming the parser sends
   * whoever reads the log to the wrong place.
   */
  it('reads a non-JSON error body as an unserved pair, not a parse failure', async () => {
    await expect(call('<html>404 Not Found</html>', 404)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PAIR',
      status: 404,
    });
  });

  it('reads a non-JSON 200 body as the anchor being unavailable', async () => {
    await expect(call('<html>hello</html>', 200)).rejects.toMatchObject({
      code: 'ANCHOR_UNAVAILABLE',
    });
  });

  it('treats an empty 200 body as an empty object rather than an error', async () => {
    await expect(client(fetchReturning('', 200)).info()).resolves.toEqual({});
  });

  it('normalizes a thrown network error', async () => {
    const boom = vi.fn(async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;

    await expect(client(boom).info()).rejects.toMatchObject({
      code: 'ANCHOR_UNAVAILABLE',
      message: expect.stringContaining('socket hang up'),
    });
  });
});

describe('firm quote', () => {
  const quoteBody = {
    id: 'q-1',
    expires_at: '2030-01-01T00:00:00Z',
    price: '0.18',
    total_price: '0.1782',
    sell_amount: '500',
    buy_amount: '89.1',
    sell_asset: BRL,
    buy_asset: USDC,
    fee: { total: '5', asset: BRL },
  };

  it('returns the reservable quote', async () => {
    await expect(
      client(fetchReturning(quoteBody)).firmQuote({
        sellAsset: BRL,
        buyAsset: USDC,
        sellAmount: '500',
        jwt: 'jwt-token',
      }),
    ).resolves.toMatchObject({ id: 'q-1', expires_at: '2030-01-01T00:00:00Z' });
  });

  /** The one SEP-38 endpoint that is authenticated. */
  it('POSTs to /quote with the SEP-10 JWT as a bearer token', async () => {
    const fetchImpl = fetchReturning(quoteBody);
    await client(fetchImpl).firmQuote({
      sellAsset: BRL,
      buyAsset: USDC,
      sellAmount: '500',
      jwt: 'jwt-token',
    });

    expect(vi.mocked(fetchImpl).mock.calls[0]![0]).toBe(`${QUOTE_SERVER}/quote`);
    const init = initOf(fetchImpl);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
  });

  it('sends the query as a JSON body in SEP-38 snake case', async () => {
    const fetchImpl = fetchReturning(quoteBody);
    await client(fetchImpl).firmQuote({
      sellAsset: BRL,
      buyAsset: USDC,
      sellAmount: '500',
      sellDeliveryMethod: 'PIX',
      buyDeliveryMethod: 'crypto',
      countryCode: 'BR',
      expireAfter: '2030-01-01T00:00:00Z',
      jwt: 'jwt-token',
    });

    expect(JSON.parse(String(initOf(fetchImpl).body))).toEqual({
      sell_asset: BRL,
      buy_asset: USDC,
      context: 'sep6',
      sell_amount: '500',
      sell_delivery_method: 'PIX',
      buy_delivery_method: 'crypto',
      country_code: 'BR',
      expire_after: '2030-01-01T00:00:00Z',
    });
  });

  it('omits every optional field the caller left unset', async () => {
    const fetchImpl = fetchReturning(quoteBody);
    await client(fetchImpl).firmQuote({ sellAsset: BRL, buyAsset: USDC, jwt: 'j' });

    expect(JSON.parse(String(initOf(fetchImpl).body))).toEqual({
      sell_asset: BRL,
      buy_asset: USDC,
      context: 'sep6',
    });
  });

  it('maps an expired or rejected JWT to AUTH_FAILED', async () => {
    await expect(
      client(fetchReturning({ error: 'token expired' }, 401)).firmQuote({
        sellAsset: BRL,
        buyAsset: USDC,
        jwt: 'stale',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('reports a non-JSON body as the anchor being unavailable', async () => {
    await expect(
      client(fetchReturning('<html>502</html>', 502)).firmQuote({
        sellAsset: BRL,
        buyAsset: USDC,
        jwt: 'j',
      }),
    ).rejects.toMatchObject({ code: 'ANCHOR_UNAVAILABLE' });
  });

  it('normalizes a thrown network error', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;

    await expect(
      client(boom).firmQuote({ sellAsset: BRL, buyAsset: USDC, jwt: 'j' }),
    ).rejects.toMatchObject({ code: 'ANCHOR_UNAVAILABLE' });
  });
});
