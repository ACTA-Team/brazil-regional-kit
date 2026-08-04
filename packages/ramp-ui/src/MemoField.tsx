'use client';

import { useId } from 'react';
import { checkMemo } from '@brk/ramp-core';
import { useRampUI } from './i18n';

/**
 * Memo input with a **byte** counter, not a character counter.
 *
 * Stellar's MEMO_TEXT limit is 28 bytes, and Portuguese and Spanish spend more
 * than one byte on most of their accented characters — "Transferência família"
 * is 21 characters and 24 bytes. A character counter would happily let a user
 * past the limit and the payment would land with a mangled or missing memo,
 * which for an anchor means an unreconcilable transfer.
 */
export function MemoField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  const { t } = useRampUI();
  const id = useId();
  const check = checkMemo(value);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm text-fg-muted">
          {label ?? t('corridor.memoLabel')}
        </label>
        <span
          className={`font-mono text-xs tabular-nums ${
            !check.valid ? 'text-danger' : check.remaining <= 6 ? 'text-gold' : 'text-fg-subtle'
          }`}
        >
          {t('corridor.memoCounter', { bytes: check.bytes, max: check.max })}
        </span>
      </div>

      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!check.valid}
        className="field mt-2"
        style={!check.valid ? { borderColor: 'rgb(248 113 113)' } : undefined}
      />

      {!check.valid ? (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {t('corridor.memoTooLong')}
        </p>
      ) : null}
    </div>
  );
}
