/**
 * Live Etherfuse HTTP client.
 *
 * Every known trap in their API is encoded here as a constant with a comment,
 * so nobody rediscovers them at 3am:
 *   - the Authorization header is the RAW key, `Bearer ` breaks it
 *   - the order endpoint is `/ramp/order`, SINGULAR — `/ramp/orders` 404s
 *   - orders are not queryable for a few seconds after creation
 */

import { RampError } from '@brk/ramp-core';
import type {
  EtherfuseApi,
  EtherfuseAsset,
  EtherfuseOnboardingRequest,
  EtherfuseOnboardingResponse,
  EtherfuseOrderRequest,
  EtherfuseOrderResponse,
  EtherfuseQuoteRequest,
  EtherfuseQuoteResponse,
} from './api';

export const ETHERFUSE_SANDBOX_URL = 'https://api.sand.etherfuse.com';
export const ETHERFUSE_PRODUCTION_URL = 'https://api.etherfuse.com';
export const ETHERFUSE_ONBOARDING_SANDBOX = 'https://devnet.etherfuse.com/ramp';

/** Endpoint paths. `/ramp/order` is singular — the plural form does not exist. */
export const ENDPOINTS = {
  onboardingUrl: '/ramp/onboarding-url',
  quote: '/ramp/quote',
  order: '/ramp/order',
  orderById: (id: string) => `/ramp/order/${encodeURIComponent(id)}`,
  fiatReceived: '/ramp/order/fiat_received',
  cryptoReceived: '/ramp/order/crypto_received',
  regenerateTx: (id: string) => `/ramp/order/${encodeURIComponent(id)}/regenerate_tx`,
  assets: '/ramp/assets',
} as const;

/**
 * Orders are not immediately readable after creation — the guide calls for a
 * 3–10s pause. We wait at the low end and let the caller's polling cover the rest.
 */
export const ORDER_INDEXING_DELAY_MS = 3_000;

export interface EtherfuseClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Per-request timeout. Anchors that hang are worse than anchors that 500. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class EtherfuseHttpClient implements EtherfuseApi {
  readonly mode = 'live' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: EtherfuseClientOptions) {
    if (!opts.apiKey) {
      throw new RampError({
        code: 'AUTH_FAILED',
        anchorId: 'etherfuse',
        message: 'Etherfuse API key missing — set ETHERFUSE_API_KEY or use mock mode.',
      });
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? ETHERFUSE_SANDBOX_URL).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          // NOT `Bearer ${key}` — Etherfuse takes the raw key. This is the
          // single most common integration mistake against their API.
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new RampError({
        code: 'ANCHOR_UNAVAILABLE',
        anchorId: 'etherfuse',
        message: `Etherfuse ${method} ${path} failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        cause,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) throw this.toError(response.status, payload, method, path);
    return payload as T;
  }

  private toError(status: number, payload: unknown, method: string, path: string): RampError {
    const message =
      (payload as { message?: string; error?: string })?.message ??
      (payload as { error?: string })?.error ??
      `Etherfuse ${method} ${path} returned ${status}`;

    const code =
      status === 401 || status === 403
        ? 'AUTH_FAILED'
        : status === 404
          ? 'INVALID_REQUEST'
          : status === 409 || status === 422
            ? 'INVALID_ORDER_STATE'
            : status >= 500
              ? 'ANCHOR_UNAVAILABLE'
              : /expir/i.test(message)
                ? 'QUOTE_EXPIRED'
                : 'INVALID_REQUEST';

    return new RampError({ code, anchorId: 'etherfuse', message, status, raw: payload });
  }

  createOnboardingUrl(req: EtherfuseOnboardingRequest): Promise<EtherfuseOnboardingResponse> {
    return this.request('POST', ENDPOINTS.onboardingUrl, req);
  }

  quote(req: EtherfuseQuoteRequest): Promise<EtherfuseQuoteResponse> {
    return this.request('POST', ENDPOINTS.quote, req);
  }

  createOrder(req: EtherfuseOrderRequest): Promise<EtherfuseOrderResponse> {
    return this.request('POST', ENDPOINTS.order, req);
  }

  getOrder(orderId: string): Promise<EtherfuseOrderResponse> {
    return this.request('GET', ENDPOINTS.orderById(orderId));
  }

  regenerateTx(orderId: string): Promise<EtherfuseOrderResponse> {
    return this.request('POST', ENDPOINTS.regenerateTx(orderId), {});
  }

  async listAssets(): Promise<EtherfuseAsset[]> {
    const payload = await this.request<EtherfuseAsset[] | { assets?: EtherfuseAsset[] }>(
      'GET',
      ENDPOINTS.assets,
    );
    return Array.isArray(payload) ? payload : (payload.assets ?? []);
  }

  simulateFiatReceived(orderId: string): Promise<EtherfuseOrderResponse> {
    return this.request('POST', ENDPOINTS.fiatReceived, { orderId });
  }

  simulateCryptoReceived(orderId: string): Promise<EtherfuseOrderResponse> {
    return this.request('POST', ENDPOINTS.cryptoReceived, { orderId });
  }
}
