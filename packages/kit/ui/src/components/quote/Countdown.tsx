'use client';

import { useEffect, useState } from 'react';
import { useRampUI } from '../../i18n/provider';

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

/** Assume a two-minute quote when the anchor gives no issue time — it only
 *  drives the ring's sweep, never the expiry decision itself. */
const ASSUMED_WINDOW_SECONDS = 120;

export function ExpiryPill({ expiresAt }: { expiresAt?: string } = {}) {
  const { t } = useRampUI();
  const seconds = useCountdown(expiresAt);

  if (!expiresAt) return null;

  const expired = seconds <= 0;
  const urgent = seconds > 0 && seconds <= 10;
  const fraction = Math.min(1, Math.max(0, seconds / ASSUMED_WINDOW_SECONDS));

  return (
    <span
      className={`chip font-mono tabular-nums ${
        expired ? 'chip-danger' : urgent ? 'chip-gold' : 'chip-neutral'
      }`}
    >
      {/*
        A draining ring rather than a bare number. Time pressure is easier to
        feel than to read, and the demo's most common stumble is a quote that
        quietly expired while someone was talking.
      */}
      {!expired ? (
        <svg viewBox="0 0 20 20" className="h-3 w-3 -rotate-90" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            opacity="0.2"
          />
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${fraction * 50.3} 50.3`}
            style={{ transition: 'stroke-dasharray 900ms linear' }}
          />
        </svg>
      ) : null}
      {expired ? t('common.expired') : t('common.expiresIn', { seconds })}
    </span>
  );
}
