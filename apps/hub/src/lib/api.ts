'use client';

/**
 * Typed client for the hub's own API routes.
 *
 * Everything anchor-facing goes through the server so the Etherfuse key never
 * reaches the browser. Errors come back as the normalized `RampError` JSON, and
 * this re-throws them as `ApiError` with the code intact so callers can react to
 * `QUOTE_EXPIRED` specifically rather than pattern-matching on a message.
 */

import type { AssetId, CountryCode, Order, Quote, RampErrorCode } from '@brk/ramp-core';

export class ApiError extends Error {
  readonly code: RampErrorCode;
  readonly anchorId?: string;
  readonly retryable: boolean;

  constructor(payload: {
    code: RampErrorCode;
    message: string;
    anchorId?: string;
    retryable?: boolean;
  }) {
    super(payload.message);
    this.name = 'ApiError';
    this.code = payload.code;
    this.anchorId = payload.anchorId;
    this.retryable = payload.retryable ?? false;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  const payload = (await response.json().catch(() => ({}))) as
    T | { error: { code: RampErrorCode; message: string; anchorId?: string; retryable?: boolean } };

  if (!response.ok) {
    const error = (payload as { error?: ApiError }).error;
    throw new ApiError(
      error ?? { code: 'UNKNOWN', message: `Request failed with ${response.status}` },
    );
  }
  return payload as T;
}

// Quotes and orders cross the wire without their `raw` anchor payload.
export type PublicQuote = Omit<Quote, 'raw'>;
export type PublicOrder = Omit<Order, 'raw'>;

export interface QuoteInput {
  anchorId: string;
  sellAsset: AssetId;
  buyAsset: AssetId;
  sellAmount: string;
  account?: string;
  country?: CountryCode;
}

export function requestQuote(input: QuoteInput): Promise<{ quote: PublicQuote }> {
  return call('/api/ramp/quote', { method: 'POST', body: JSON.stringify(input) });
}

export function createOrder(input: {
  anchorId: string;
  quoteId: string;
  account: string;
}): Promise<{ order: PublicOrder }> {
  return call('/api/ramp/order', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchOrder(orderId: string, anchorId: string): Promise<{ order: PublicOrder }> {
  return call(
    `/api/ramp/order/${encodeURIComponent(orderId)}?anchorId=${encodeURIComponent(anchorId)}`,
  );
}

export function simulateLeg(
  orderId: string,
  leg: 'fiat' | 'crypto',
  anchorId: string,
): Promise<{ order: PublicOrder }> {
  return call(`/api/ramp/order/${encodeURIComponent(orderId)}/simulate`, {
    method: 'POST',
    body: JSON.stringify({ leg, anchorId }),
  });
}

export function submitSignedTx(signedXdr: string): Promise<{ hash: string; successful: boolean }> {
  return call('/api/tx/submit', { method: 'POST', body: JSON.stringify({ signedXdr }) });
}
