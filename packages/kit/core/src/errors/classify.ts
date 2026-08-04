import type { RampErrorCode } from './errors';

/**
 * Sort any thrown thing into the bucket a UI should explain it as.
 *
 * This lives beside `RampError` rather than in the app because it is the part
 * with actual logic — which of several readings of a failure is the true one —
 * and because every consumer of the packages faces the same question. The
 * wording is not here: `classifyError` returns a code, and the caller supplies
 * the sentence in whatever language it speaks.
 *
 * The interesting decision is precedence. A wallet rejection usually arrives
 * wrapped as a chain failure, because the wallet refuses and the submit path
 * throws; reporting "the network refused your transaction" when the user
 * pressed Cancel is a lie the UI should not tell, so the text check wins over
 * the code.
 */
export type FriendlyCode =
  | RampErrorCode
  /** The user pressed Cancel in their wallet. Not a failure. */
  | 'WALLET_REJECTED'
  /** The request never reached the server. */
  | 'OFFLINE';

const RAMP_CODES: ReadonlySet<string> = new Set<RampErrorCode>([
  'UNSUPPORTED_PAIR',
  'ANCHOR_UNAVAILABLE',
  'QUOTE_EXPIRED',
  'AMOUNT_OUT_OF_RANGE',
  'KYC_REQUIRED',
  'AUTH_FAILED',
  'INVALID_REQUEST',
  'INVALID_ORDER_STATE',
  'CHAIN_ERROR',
  'UNKNOWN',
]);

/** Trying the identical thing again could plausibly work for these. */
const RETRYABLE: ReadonlySet<FriendlyCode> = new Set<FriendlyCode>([
  'ANCHOR_UNAVAILABLE',
  'QUOTE_EXPIRED',
  'CHAIN_ERROR',
  'OFFLINE',
]);

/**
 * Wallets do not agree on a rejection code, so this is matched on text.
 * Freighter says "User declined access", xBull "rejected", Albedo "cancelled".
 * Anchored on word boundaries so "undeclared" or "cancellation policy" in an
 * unrelated message cannot trip it.
 */
const WALLET_REJECTED = /\b(?:declined|rejected|denied|cancell?ed)\b/i;

/** A fetch that never reached a server throws a TypeError carrying no status. */
const NETWORK_TEXT = /\b(?:failed to fetch|network\s?error|load failed)\b/i;

/** The raw message, from whatever shape was thrown. */
export function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}

/** The `code` field, when it is one this layer knows. */
export function errorCode(e: unknown): RampErrorCode | null {
  if (typeof e !== 'object' || e === null || !('code' in e)) return null;
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' && RAMP_CODES.has(code) ? (code as RampErrorCode) : null;
}

/** The `anchorId` field, when the error names one. */
export function errorAnchor(e: unknown): string | null {
  if (typeof e !== 'object' || e === null || !('anchorId' in e)) return null;
  const id = (e as { anchorId?: unknown }).anchorId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export interface ClassifyOptions {
  /**
   * Whether the client believes it has a connection. Passed in rather than read
   * off `navigator`, so this stays usable server-side and testable without a
   * DOM. `undefined` means "no opinion" and the text check decides.
   */
  online?: boolean;
}

export function classifyError(e: unknown, opts: ClassifyOptions = {}): FriendlyCode {
  const text = errorText(e);

  // Intent beats mechanism: the user cancelling is the truer reading of a
  // rejection that also surfaced as a chain failure.
  if (WALLET_REJECTED.test(text)) return 'WALLET_REJECTED';

  // A classified anchor failure is more specific than "you might be offline",
  // so an explicit code wins over the offline heuristic. Only fall to OFFLINE
  // when nothing classified it.
  const code = errorCode(e);
  if (code && code !== 'UNKNOWN') return code;

  if (opts.online === false) return 'OFFLINE';
  if (e instanceof TypeError && NETWORK_TEXT.test(text)) return 'OFFLINE';

  return code ?? 'UNKNOWN';
}

export function isRetryable(code: FriendlyCode): boolean {
  return RETRYABLE.has(code);
}

/**
 * Etherfuse refuses a second pending order keyed on (bank account, amount) and
 * offers no cancel endpoint, so the generic "start a new one" advice is wrong:
 * only a different amount clears it. Worth recognising by hand.
 */
export function isDuplicateOrder(e: unknown): boolean {
  return errorCode(e) === 'INVALID_ORDER_STATE' && /already exists/i.test(errorText(e));
}
