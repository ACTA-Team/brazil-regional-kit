/**
 * One error type across every anchor.
 *
 * Anchors report failures in wildly different shapes — Etherfuse returns
 * `{message}` with a 4xx, SEP anchors return `{error}`, mocks throw. The router
 * has to decide "skip this anchor and keep going" vs "surface to the user", and
 * it can only do that against a normalized code.
 */

export type RampErrorCode =
  /** The anchor does not serve this currency pair / country. Not a failure. */
  | 'UNSUPPORTED_PAIR'
  /** Anchor unreachable, timed out, or 5xx. Router marks it `failed` and moves on. */
  | 'ANCHOR_UNAVAILABLE'
  /** Quote is past its expiry — re-quote and retry. */
  | 'QUOTE_EXPIRED'
  /** Amount below/above the anchor's limits. */
  | 'AMOUNT_OUT_OF_RANGE'
  /** Customer needs to complete KYC before this operation. */
  | 'KYC_REQUIRED'
  /** Bad or missing API credentials. */
  | 'AUTH_FAILED'
  /** Caller passed something invalid (bad memo, bad address, missing field). */
  | 'INVALID_REQUEST'
  /** Order exists but is in a state that forbids the requested transition. */
  | 'INVALID_ORDER_STATE'
  /** On-chain submission failed. */
  | 'CHAIN_ERROR'
  /** Anything we could not classify. */
  | 'UNKNOWN';

export interface RampErrorOptions {
  code: RampErrorCode;
  message: string;
  /** Which adapter produced this, e.g. `etherfuse`. */
  anchorId?: string;
  /** Whether an immediate retry could plausibly succeed. */
  retryable?: boolean;
  /** HTTP status, when the failure came from a REST call. */
  status?: number;
  /** The anchor's untouched response, kept for debugging and fixture recording. */
  raw?: unknown;
  cause?: unknown;
}

export class RampError extends Error {
  readonly code: RampErrorCode;
  readonly anchorId?: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly raw?: unknown;

  constructor(opts: RampErrorOptions) {
    super(opts.message, { cause: opts.cause });
    this.name = 'RampError';
    this.code = opts.code;
    this.anchorId = opts.anchorId;
    this.retryable = opts.retryable ?? DEFAULT_RETRYABLE.has(opts.code);
    this.status = opts.status;
    this.raw = opts.raw;
  }

  /** Safe to send to the browser — never includes `raw`, which may hold PII. */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      anchorId: this.anchorId,
      retryable: this.retryable,
      status: this.status,
    };
  }
}

const DEFAULT_RETRYABLE = new Set<RampErrorCode>([
  'ANCHOR_UNAVAILABLE',
  'QUOTE_EXPIRED',
  'CHAIN_ERROR',
]);

export function isRampError(e: unknown): e is RampError {
  return e instanceof RampError;
}

/** Wrap an unknown thrown value so callers always get a RampError. */
export function toRampError(e: unknown, anchorId?: string): RampError {
  if (isRampError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  const isAbort = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
  return new RampError({
    code: isAbort ? 'ANCHOR_UNAVAILABLE' : 'UNKNOWN',
    message,
    anchorId,
    cause: e,
  });
}
