'use client';

import type { AdapterMode } from '@brk/ramp-core';
import { useI18n } from '@/lib/i18n';

/**
 * The honesty badge.
 *
 * Every quote, order and swap in this app carries one. A demo that quietly
 * fakes an anchor is worth nothing; a demo that says exactly which parts are
 * live and which are replaying fixtures is worth a great deal — and it is the
 * only way anyone can trust the parts that ARE real.
 *
 * Live is green and mock is neutral-dashed, not gold. The manual's badge row
 * does allow a gold state, but a quote table can carry a dozen of these at
 * once; painting them gold would flood the screen with the accent and leave
 * the actual primary action with nothing to stand out against.
 */
export function ModeBadge({
  mode,
  title,
  className = '',
}: {
  mode: AdapterMode;
  title?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const live = mode === 'live';

  return (
    <span
      title={title ?? t(live ? 'mode.liveHint' : 'mode.mockHint')}
      className={`chip uppercase ${live ? 'chip-success' : 'chip-neutral border-dashed'} ${className}`}
    >
      {live ? (
        // A heartbeat, because "live" is a claim the UI should keep making.
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
        </span>
      ) : (
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-fg-subtle" />
      )}
      {t(live ? 'mode.live' : 'mode.mock')}
    </span>
  );
}
