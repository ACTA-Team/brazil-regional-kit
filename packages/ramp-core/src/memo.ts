/**
 * Stellar MEMO_TEXT is capped at 28 BYTES, not 28 characters.
 *
 * This is one of the most expensive gotchas in the ecosystem: an over-long memo
 * does not bounce with a clear error — the payment can land with a truncated or
 * missing memo and the anchor never credits the customer. `"João da Conceição"`
 * is 17 characters but 20 bytes; `"Transferência família"` is 21 characters and
 * 24 bytes. So we measure bytes, and we throw rather than truncate.
 */

import { RampError } from './errors';

export const MEMO_TEXT_MAX_BYTES = 28;

const encoder = new TextEncoder();

export function memoByteLength(memo: string): number {
  return encoder.encode(memo).length;
}

export interface MemoCheck {
  valid: boolean;
  bytes: number;
  max: number;
  /** Bytes still available. Negative when over the limit. */
  remaining: number;
}

/** Non-throwing check — use this to drive a live character counter in a form. */
export function checkMemo(memo: string): MemoCheck {
  const bytes = memoByteLength(memo);
  return {
    valid: bytes <= MEMO_TEXT_MAX_BYTES,
    bytes,
    max: MEMO_TEXT_MAX_BYTES,
    remaining: MEMO_TEXT_MAX_BYTES - bytes,
  };
}

/**
 * Throwing check for the payment path. Never let an oversized memo reach the
 * network: silent truncation is worse than a rejected form.
 */
export function validateMemo(memo: string): string {
  const { valid, bytes } = checkMemo(memo);
  if (!valid) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message:
        `Memo is ${bytes} bytes; Stellar MEMO_TEXT allows ${MEMO_TEXT_MAX_BYTES}. ` +
        `Accented characters cost more than one byte each — shorten the memo.`,
    });
  }
  return memo;
}

/**
 * Best-effort shortening for memos we generate ourselves (order references),
 * never for user-supplied text. Cuts on a byte boundary without splitting a
 * multi-byte character.
 */
export function truncateMemo(memo: string, max = MEMO_TEXT_MAX_BYTES): string {
  if (memoByteLength(memo) <= max) return memo;
  let out = '';
  for (const char of memo) {
    if (memoByteLength(out + char) > max) break;
    out += char;
  }
  return out;
}
