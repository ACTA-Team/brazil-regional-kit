/**
 * The live Etherfuse HTTP client.
 *
 * The comments in `client.ts` list the traps this integration hit — the raw
 * Authorization header, the singular order path, the envelope-vs-flat order
 * shape, plain-text error bodies. Comments rot; these tests do not. Each one
 * below pins a trap so it cannot be quietly reintroduced.
 *
 * `fetch` is injected, so no test here touches the sandbox.
 */

import { describe, expect, it, vi } from 'vitest';
import { ENDPOINTS, ETHERFUSE_SANDBOX_URL, EtherfuseHttpClient, unwrapOrder } from './client';

const API_KEY = 'test-api-key';

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    typeof body === 'string'
      ? new Response(body, { status })
      : new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

const client = (fetchImpl: typeof fetch, opts: Record<string, unknown> = {}) =>
  new EtherfuseHttpClient({ apiKey: API_KEY, fetchImpl, ...opts });

const urlOf = (fetchImpl: typeof fetch, call = 0) =>
  String(vi.mocked(fetchImpl).mock.calls[call]![0]);
const initOf = (fetchImpl: typeof fetch, call = 0) =>
  vi.mocked(fetchImpl).mock.calls[call]![1] as RequestInit;

const ORDER = { orderId: 'ord_1', status: 'PENDING_PAYMENT', quoteId: 'q_1' };

describe('construction', () => {
  it('refuses to build without an API key instead of failing at the first request', () => {
    expect(() => new EtherfuseHttpClient({ apiKey: '' })).toThrow(
      expect.objectContaining({ code: 'AUTH_FAILED', anchorId: 'etherfuse' }),
    );
  });

  it('names the env var to set, so the fix is obvious', () => {
    expect(() => new EtherfuseHttpClient({ apiKey: '' })).toThrow(/ETHERFUSE_API_KEY/);
  });

  it('defaults to the sandbox', async () => {
    const fetchImpl = fetchReturning(ORDER);
    await client(fetchImpl).getOrder('ord_1');

    expect(urlOf(fetchImpl).startsWith(ETHERFUSE_SANDBOX_URL)).toBe(true);
  });

  it('honours a custom base URL and trims trailing slashes', async () => {
    const fetchImpl = fetchReturning(ORDER);
    await client(fetchImpl, { baseUrl: 'https://api.example.com//' }).getOrder('ord_1');

    expect(urlOf(fetchImpl)).toBe('https://api.example.com/ramp/order/ord_1');
  });

  it('reports itself as the live transport', () => {
    expect(client(fetchReturning({})).mode).toBe('live');
  });
});

describe('authentication', () => {
  /**
   * The single most common mistake against this API. `Bearer ` prefixed onto the
   * key produces a 401 that reads exactly like a wrong key, and costs an hour.
   */
  it('sends the raw key, never a Bearer token', async () => {
    const fetchImpl = fetchReturning(ORDER);
    await client(fetchImpl).getOrder('ord_1');

    const headers = initOf(fetchImpl).headers as Record<string, string>;
    expect(headers.Authorization).toBe(API_KEY);
    expect(headers.Authorization).not.toMatch(/^Bearer/i);
  });

  it('asks for and sends JSON', async () => {
    const fetchImpl = fetchReturning(ORDER);
    await client(fetchImpl).getOrder('ord_1');

    const headers = initOf(fetchImpl).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('application/json');
  });
});

describe('endpoint shapes', () => {
  /** `/ramp/orders` does not exist. The plural form 404s. */
  it('posts an order to the singular /ramp/order', async () => {
    const fetchImpl = fetchReturning({ onramp: ORDER });
    await client(fetchImpl).createOrder({
      orderId: 'ord_1',
      bankAccountId: 'bank_1',
      publicKey: 'GABC',
      quoteId: 'q_1',
    });

    expect(ENDPOINTS.order).toBe('/ramp/order');
    expect(urlOf(fetchImpl).endsWith('/ramp/order')).toBe(true);
    expect(urlOf(fetchImpl)).not.toContain('/ramp/orders');
  });

  it('percent-encodes an order id rather than splicing it into the path', async () => {
    const fetchImpl = fetchReturning(ORDER);
    await client(fetchImpl).getOrder('ord/../admin');

    expect(urlOf(fetchImpl).endsWith('/ramp/order/ord%2F..%2Fadmin')).toBe(true);
  });

  it('sends all three mandatory asset-query parameters', async () => {
    const fetchImpl = fetchReturning([]);
    await client(fetchImpl).listAssets({
      blockchain: 'stellar',
      currency: 'BRL',
      wallet: 'GABC',
    });

    const params = new URL(urlOf(fetchImpl)).searchParams;
    expect(params.get('blockchain')).toBe('stellar');
    expect(params.get('currency')).toBe('BRL');
    expect(params.get('wallet')).toBe('GABC');
  });

  it('accepts an asset list either bare or wrapped in {assets}', async () => {
    const query = { blockchain: 'stellar' as const, currency: 'BRL', wallet: 'GABC' };
    const bare = [{ code: 'TESOURO' }];

    await expect(client(fetchReturning(bare)).listAssets(query)).resolves.toEqual(bare);
    await expect(client(fetchReturning({ assets: bare })).listAssets(query)).resolves.toEqual(bare);
  });

  it('reports no assets rather than undefined when the wrapper is empty', async () => {
    await expect(
      client(fetchReturning({})).listAssets({
        blockchain: 'stellar',
        currency: 'BRL',
        wallet: 'GABC',
      }),
    ).resolves.toEqual([]);
  });

  it('posts the order id in the body for the sandbox settlement simulators', async () => {
    const fiat = fetchReturning({ onramp: ORDER });
    await client(fiat).simulateFiatReceived('ord_1');
    expect(urlOf(fiat).endsWith(ENDPOINTS.fiatReceived)).toBe(true);
    expect(JSON.parse(String(initOf(fiat).body))).toEqual({ orderId: 'ord_1' });

    const crypto = fetchReturning({ offramp: ORDER });
    await client(crypto).simulateCryptoReceived('ord_1');
    expect(urlOf(crypto).endsWith(ENDPOINTS.cryptoReceived)).toBe(true);
    expect(JSON.parse(String(initOf(crypto).body))).toEqual({ orderId: 'ord_1' });
  });

  it('regenerates a transaction on the order’s own path', async () => {
    const fetchImpl = fetchReturning({ offramp: ORDER });
    await client(fetchImpl).regenerateTx('ord_1');

    expect(urlOf(fetchImpl).endsWith('/ramp/order/ord_1/regenerate_tx')).toBe(true);
    expect(initOf(fetchImpl).method).toBe('POST');
  });

  it('sends no body on a GET', async () => {
    const fetchImpl = fetchReturning(ORDER);
    await client(fetchImpl).getOrder('ord_1');

    expect(initOf(fetchImpl).method).toBe('GET');
    expect(initOf(fetchImpl).body).toBeUndefined();
  });
});

describe('order envelope', () => {
  /**
   * `POST /ramp/order` wraps the payload in a direction key; `GET` returns it
   * flat. Reading the create response as if it were flat yields an order with
   * `undefined` everywhere, which looks like a broken anchor and is not.
   */
  it('unwraps an on-ramp envelope', () => {
    expect(unwrapOrder({ onramp: ORDER })).toEqual(ORDER);
  });

  it('unwraps an off-ramp envelope', () => {
    expect(unwrapOrder({ offramp: ORDER })).toEqual(ORDER);
  });

  it('passes a flat order through untouched', () => {
    expect(unwrapOrder(ORDER)).toEqual(ORDER);
  });

  it('unwraps on create, where the envelope actually appears', async () => {
    await expect(
      client(fetchReturning({ onramp: ORDER })).createOrder({
        orderId: 'ord_1',
        bankAccountId: 'bank_1',
        publicKey: 'GABC',
        quoteId: 'q_1',
      }),
    ).resolves.toEqual(ORDER);
  });
});

describe('error classification', () => {
  const failing = (body: unknown, status: number) =>
    client(fetchReturning(body, status)).getOrder('ord_1');

  it('maps 401 and 403 to AUTH_FAILED', async () => {
    await expect(failing({ message: 'bad key' }, 401)).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
    await expect(failing({ message: 'forbidden' }, 403)).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
  });

  /**
   * The most useful diagnostic in the whole integration. Etherfuse sends it as
   * a bare string, so a client that only reads JSON fields turns "your customer
   * has not finished KYC" into an anonymous 400 and nobody knows what to fix.
   */
  it('recognises the plain-text KYC signal', async () => {
    await expect(failing('Proxy account not found', 400)).rejects.toMatchObject({
      code: 'KYC_REQUIRED',
      message: 'Proxy account not found',
    });
  });

  it('recognises the KYC signal in a JSON body too', async () => {
    await expect(failing({ message: 'proxy account not found' }, 404)).rejects.toMatchObject({
      code: 'KYC_REQUIRED',
    });
  });

  it('maps 404 to INVALID_REQUEST', async () => {
    await expect(failing({ message: 'no such order' }, 404)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('maps 409 and 422 to INVALID_ORDER_STATE', async () => {
    await expect(failing({ message: 'already settled' }, 409)).rejects.toMatchObject({
      code: 'INVALID_ORDER_STATE',
    });
    await expect(failing({ message: 'unprocessable' }, 422)).rejects.toMatchObject({
      code: 'INVALID_ORDER_STATE',
    });
  });

  it('maps 5xx to ANCHOR_UNAVAILABLE', async () => {
    await expect(failing({ message: 'boom' }, 502)).rejects.toMatchObject({
      code: 'ANCHOR_UNAVAILABLE',
    });
  });

  /** Quotes expire in about two minutes, so this is a routine, retryable state. */
  it('reads an expiry message as QUOTE_EXPIRED', async () => {
    await expect(failing({ message: 'quote has expired' }, 400)).rejects.toMatchObject({
      code: 'QUOTE_EXPIRED',
      retryable: true,
    });
  });

  it('prefers `message`, then `error`, then the raw text', async () => {
    await expect(failing({ message: 'from message', error: 'from error' }, 400)).rejects.toThrow(
      'from message',
    );
    await expect(failing({ error: 'from error' }, 400)).rejects.toThrow('from error');
    await expect(failing('   from raw text  ', 400)).rejects.toThrow('from raw text');
  });

  it('falls back to a descriptive message when the body says nothing', async () => {
    await expect(failing({}, 400)).rejects.toThrow(/GET \/ramp\/order\/ord_1 returned 400/);
  });

  it('keeps the status and raw payload for debugging', async () => {
    await expect(failing({ message: 'nope', detail: 'x' }, 409)).rejects.toMatchObject({
      status: 409,
      raw: { message: 'nope', detail: 'x' },
      anchorId: 'etherfuse',
    });
  });

  it('normalizes a transport failure to ANCHOR_UNAVAILABLE', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;

    await expect(client(boom).getOrder('ord_1')).rejects.toMatchObject({
      code: 'ANCHOR_UNAVAILABLE',
      anchorId: 'etherfuse',
      message: expect.stringContaining('ECONNRESET'),
    });
  });

  it('treats an unparseable success body as raw text rather than crashing', async () => {
    await expect(client(fetchReturning('<html>ok</html>', 200)).getOrder('ord_1')).resolves.toEqual(
      {
        raw: '<html>ok</html>',
      },
    );
  });

  it('treats an empty success body as an empty object', async () => {
    await expect(client(fetchReturning('', 200)).getOrder('ord_1')).resolves.toEqual({});
  });
});

describe('timeouts', () => {
  /** An anchor that hangs is worse than one that 500s — it stalls the router. */
  it('aborts a request that outlives the timeout', async () => {
    const hang = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    ) as unknown as typeof fetch;

    await expect(client(hang, { timeoutMs: 10 }).getOrder('ord_1')).rejects.toMatchObject({
      code: 'ANCHOR_UNAVAILABLE',
    });
  });

  it('passes an abort signal on every request', async () => {
    const fetchImpl = fetchReturning(ORDER);
    await client(fetchImpl).getOrder('ord_1');

    expect(initOf(fetchImpl).signal).toBeInstanceOf(AbortSignal);
  });
});
