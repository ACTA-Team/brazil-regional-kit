'use client';

import {
  classifyError,
  errorAnchor,
  errorText,
  isDuplicateOrder,
  isRetryable,
  type FriendlyCode,
} from '@brk/ramp-core';
import type { Translate } from '@/client/i18n';

/**
 * Turn a thrown thing into something a person can act on.
 *
 * Every failure in this app used to reach the screen as whatever string the
 * anchor, the wallet or Horizon happened to produce — "INVALID_ORDER_STATE: an
 * order for this bank account and amount already exists" is accurate and
 * useless to the person reading it. It says what broke, never what they should
 * do, and it reads like the app fell over even when the answer is "the price
 * moved, ask again".
 *
 * So each failure gets a title that names the situation, a body that says whose
 * problem it is and what happens next, and — crucially — the raw text kept
 * alongside rather than thrown away. Hiding the real error would trade one kind
 * of unhelpful for another: this demo is watched by people who want to check
 * the integration, and a support conversation needs the actual string. It is
 * demoted into a disclosure, not deleted.
 *
 * The sorting itself lives in `@brk/ramp-core` — it is pure, every consumer of
 * the packages needs it, and it is where the tests for it can run. This file is
 * only the part that speaks the user's language.
 */
export interface FriendlyError {
  /** The bucket this was sorted into — also the i18n key stem. */
  code: FriendlyCode;
  title: string;
  message: string;
  /**
   * The untouched technical text, plus the code and anchor when we have them.
   * `null` only when there is nothing the friendly copy did not already say.
   */
  detail: string | null;
  /** Whether trying the exact same thing again could plausibly work. */
  retryable: boolean;
}

export function friendlyError(error: unknown, t: Translate): FriendlyError {
  const code = classifyError(error, {
    // The one piece of browser state the classifier cannot read for itself.
    online: typeof navigator === 'undefined' ? undefined : navigator.onLine,
  });

  const title = t(`error.${code}.title`);
  const message = t(`error.${code}.body`);

  // Keep the technical line unless it adds nothing: an empty raw string, or one
  // the friendly copy already reproduces word for word.
  const raw = errorText(error).trim();
  const anchor = errorAnchor(error);
  const parts: string[] = [];
  if (raw && raw !== message && raw !== title) parts.push(raw);
  parts.push([code, anchor].filter(Boolean).join(' · '));

  return {
    code,
    title,
    message,
    detail: parts.length ? parts.join('\n') : null,
    retryable: isRetryable(code),
  };
}

export { isDuplicateOrder };
