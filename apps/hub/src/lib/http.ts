import { NextResponse } from 'next/server';
import { isRampError, toRampError } from '@brk/ramp-core';

/**
 * One error shape for every API route.
 *
 * `RampError.toJSON()` deliberately omits `raw`, which can hold anchor payloads
 * with customer data — so anchor errors reach the browser as a code, a message
 * and a retryable flag, and nothing else.
 */
export function errorResponse(e: unknown, anchorId?: string): NextResponse {
  const err = isRampError(e) ? e : toRampError(e, anchorId);

  const status =
    err.code === 'AUTH_FAILED'
      ? 502 // our credentials, not the caller's
      : err.code === 'ANCHOR_UNAVAILABLE'
        ? 503
        : err.code === 'UNSUPPORTED_PAIR' || err.code === 'INVALID_REQUEST'
          ? 400
          : err.code === 'QUOTE_EXPIRED' || err.code === 'INVALID_ORDER_STATE'
            ? 409
            : 500;

  if (err.code === 'UNKNOWN' || status >= 500) {
    console.error('[brk]', err.code, err.message, err.raw ?? '');
  }

  return NextResponse.json({ error: err.toJSON() }, { status });
}

/** Strip `raw` before anything crosses the wire. */
export function publicQuote<T extends { raw?: unknown }>(value: T): Omit<T, 'raw'> {
  const { raw: _raw, ...rest } = value;
  return rest;
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error('Request body must be JSON.');
  }
}
