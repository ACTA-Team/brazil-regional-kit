'use client';

import type { AdapterMode } from '@brk/ramp-core';
import { useI18n } from '@/lib/i18n';

/**
 * The honesty badge.
 *
 * Every quote, order and swap in this app carries one. A demo that quietly
 * fakes an anchor is worth nothing; a demo that says exactly which parts are
 * live and which are replaying fixtures is worth a great deal — and it is the
 * only way a judge can trust the parts that ARE real.
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
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        live
          ? 'border-brand-600 bg-brand-700/25 text-brand-200'
          : 'border-accent-500 bg-accent-500/15 text-accent-300'
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-brand-400' : 'bg-accent-400'}`}
      />
      {t(live ? 'mode.live' : 'mode.mock')}
    </span>
  );
}
