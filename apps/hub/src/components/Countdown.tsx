'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

/**
 * Seconds remaining until `isoTimestamp`, ticking once a second.
 *
 * Etherfuse quotes expire in seconds, not minutes. Without a visible countdown
 * the user finds out the quote died only when the order fails — which, mid-demo,
 * reads as "the integration is broken" rather than "the price moved".
 */
export function useCountdown(isoTimestamp?: string): number {
  // The remaining time is not state — it is a function of the clock, which
  // React does not own. Holding it in state means storing a value that is
  // already stale by the time it renders, and needing an effect to correct it
  // whenever the timestamp changes. Instead: tick to schedule a re-render, and
  // compute the answer during that render.
  const [, tick] = useState(0);

  useEffect(() => {
    if (!isoTimestamp) return;

    const id = setInterval(() => {
      tick((n) => n + 1);
      if (secondsUntil(isoTimestamp) <= 0) clearInterval(id);
    }, 1000);

    return () => clearInterval(id);
  }, [isoTimestamp]);

  return secondsUntil(isoTimestamp);
}

function secondsUntil(iso?: string): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
}

export function ExpiryPill({ expiresAt }: { expiresAt?: string } = {}) {
  const { t } = useI18n();
  const seconds = useCountdown(expiresAt);

  if (!expiresAt) return null;

  const expired = seconds <= 0;
  const urgent = seconds > 0 && seconds <= 10;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums ${
        expired
          ? 'bg-red-500/15 text-red-300'
          : urgent
            ? 'bg-accent-500/15 text-accent-300'
            : 'bg-surface-inset text-ink-400'
      }`}
    >
      {expired ? t('common.expired') : t('common.expiresIn', { seconds })}
    </span>
  );
}
