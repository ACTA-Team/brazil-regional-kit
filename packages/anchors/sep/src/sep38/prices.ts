/**
 * SEP-38 — Anchor Quote API.
 *
 * The useful discovery here: `/info`, `/prices` and `/price` need **no
 * authentication**. That means a client can show live, real quotes from any
 * SEP-38 anchor before the user has signed anything, created an account or
 * completed KYC — which is exactly what a multi-anchor router needs to rank
 * options. Only `POST /quote` (a firm, reservable quote) requires a SEP-10 JWT.
 */

import { RampError, stripTrailingSlashes, type AssetId } from '@brk/ramp-core';

export interface Sep38DeliveryMethod {
  name: string;
  description?: string;
}

export interface Sep38Asset {
  asset: AssetId;
  country_codes?: string[];
  sell_delivery_methods?: Sep38DeliveryMethod[];
  buy_delivery_methods?: Sep38DeliveryMethod[];
}

export interface Sep38Info {
  assets: Sep38Asset[];
}

export interface Sep38Fee {
  total: string;
  asset: AssetId;
  details?: Array<{ name: string; description?: string; amount: string }>;
}

export interface Sep38Price {
  /** Excludes fees. */
  price: string;
  /** Includes fees — this is the number a user actually experiences. */
  total_price: string;
  sell_amount: string;
  buy_amount: string;
  fee: Sep38Fee;
}

export interface Sep38FirmQuote extends Sep38Price {
  id: string;
  expires_at: string;
  sell_asset: AssetId;
  buy_asset: AssetId;
}

export interface Sep38ClientOptions {
  /** From the TOML's `ANCHOR_QUOTE_SERVER`. */
  quoteServer: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type Sep38Context = 'sep6' | 'sep31';

export interface PriceQuery {
  sellAsset: AssetId;
  buyAsset: AssetId;
  sellAmount?: string;
  buyAmount?: string;
  context?: Sep38Context;
  /** Required by most anchors when the fiat side is being sold. */
  sellDeliveryMethod?: string;
  buyDeliveryMethod?: string;
  countryCode?: string;
}

export class Sep38Client {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: Sep38ClientOptions) {
    this.base = stripTrailingSlashes(opts.quoteServer);
    this.timeoutMs = opts.timeoutMs ?? 8_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  private async get<T>(path: string, params?: URLSearchParams, jwt?: string): Promise<T> {
    const url = `${this.base}${path}${params && [...params].length ? `?${params}` : ''}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
      });

      const text = await response.text();
      const payload = parseJsonOrNull(text);

      // Anchors routinely answer an unsupported pair with an HTML error page
      // rather than a JSON body. Reporting that as a parse failure blames the
      // wrong thing — the corridor is simply not served.
      if (payload === null) {
        throw new RampError({
          code: response.ok ? 'ANCHOR_UNAVAILABLE' : 'UNSUPPORTED_PAIR',
          message: response.ok
            ? `SEP-38 ${path} returned a non-JSON body.`
            : `SEP-38 ${path} returned ${response.status} with a non-JSON body — the anchor does not serve this pair.`,
          status: response.status,
        });
      }

      if (!response.ok) throw toRampError(response.status, payload, path);
      return payload as T;
    } catch (cause) {
      if (cause instanceof RampError) throw cause;
      throw new RampError({
        code: 'ANCHOR_UNAVAILABLE',
        message: `SEP-38 ${path} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Unauthenticated. Which assets and corridors this anchor serves. */
  info(): Promise<Sep38Info> {
    return this.get<Sep38Info>('/info');
  }

  /** Unauthenticated. Every asset the anchor will give you for `sellAsset`. */
  prices(query: {
    sellAsset: AssetId;
    sellAmount: string;
    sellDeliveryMethod?: string;
    buyDeliveryMethod?: string;
    countryCode?: string;
  }): Promise<{ buy_assets: Array<{ asset: AssetId; price: string; decimals: number }> }> {
    const params = new URLSearchParams({
      sell_asset: query.sellAsset,
      sell_amount: query.sellAmount,
    });
    if (query.sellDeliveryMethod) params.set('sell_delivery_method', query.sellDeliveryMethod);
    if (query.buyDeliveryMethod) params.set('buy_delivery_method', query.buyDeliveryMethod);
    if (query.countryCode) params.set('country_code', query.countryCode);
    return this.get('/prices', params);
  }

  /** Unauthenticated indicative price for one specific pair. */
  price(query: PriceQuery): Promise<Sep38Price> {
    const params = new URLSearchParams({
      sell_asset: query.sellAsset,
      buy_asset: query.buyAsset,
      context: query.context ?? 'sep6',
    });
    if (query.sellAmount) params.set('sell_amount', query.sellAmount);
    if (query.buyAmount) params.set('buy_amount', query.buyAmount);
    if (query.sellDeliveryMethod) params.set('sell_delivery_method', query.sellDeliveryMethod);
    if (query.buyDeliveryMethod) params.set('buy_delivery_method', query.buyDeliveryMethod);
    if (query.countryCode) params.set('country_code', query.countryCode);
    return this.get('/price', params);
  }

  /**
   * Firm, reservable quote. Needs a SEP-10 JWT — this is the one endpoint in
   * SEP-38 that does.
   */
  async firmQuote(
    query: PriceQuery & { jwt: string; expireAfter?: string },
  ): Promise<Sep38FirmQuote> {
    const url = `${this.base}/quote`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const body: Record<string, string> = {
      sell_asset: query.sellAsset,
      buy_asset: query.buyAsset,
      context: query.context ?? 'sep6',
    };
    if (query.sellAmount) body.sell_amount = query.sellAmount;
    if (query.buyAmount) body.buy_amount = query.buyAmount;
    if (query.sellDeliveryMethod) body.sell_delivery_method = query.sellDeliveryMethod;
    if (query.buyDeliveryMethod) body.buy_delivery_method = query.buyDeliveryMethod;
    if (query.countryCode) body.country_code = query.countryCode;
    if (query.expireAfter) body.expire_after = query.expireAfter;

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${query.jwt}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = parseJsonOrNull(text);
      if (payload === null) {
        throw new RampError({
          code: 'ANCHOR_UNAVAILABLE',
          message: `SEP-38 /quote returned ${response.status} with a non-JSON body.`,
          status: response.status,
        });
      }
      if (!response.ok) throw toRampError(response.status, payload, '/quote');
      return payload as Sep38FirmQuote;
    } catch (cause) {
      if (cause instanceof RampError) throw cause;
      throw new RampError({
        code: 'ANCHOR_UNAVAILABLE',
        message: `SEP-38 /quote failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** `null` means "this was not JSON at all", distinct from an empty body. */
function parseJsonOrNull(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toRampError(status: number, payload: unknown, path: string): RampError {
  const message = (payload as { error?: string })?.error ?? `SEP-38 ${path} returned ${status}`;

  const code =
    status === 401 || status === 403
      ? 'AUTH_FAILED'
      : status === 400 && /not (supported|available)|unsupported/i.test(message)
        ? 'UNSUPPORTED_PAIR'
        : status === 400
          ? 'INVALID_REQUEST'
          : status >= 500
            ? 'ANCHOR_UNAVAILABLE'
            : 'INVALID_REQUEST';

  return new RampError({ code, message, status, raw: payload });
}
