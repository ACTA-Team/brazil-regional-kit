'use client';

import { Check, ICON_WEIGHT, Info, Warning, X, type Icon } from './icons';

/**
 * Feedback, in the manual's four semantic colours.
 *
 * Each tone is a tinted background behind a coloured left rail rather than a
 * saturated block: "clarity over decoration", and it keeps a success message
 * from shouting louder than the gold button next to it.
 */
const TONES: Record<
  'error' | 'warning' | 'success' | 'info',
  { wrap: string; rail: string; ink: string; icon: Icon }
> = {
  error: {
    wrap: 'border-danger/35 bg-danger/8 text-[#ffb3b4]',
    rail: 'bg-danger',
    ink: 'text-canvas',
    icon: X,
  },
  warning: {
    wrap: 'border-gold/35 bg-gold/8 text-gold',
    rail: 'bg-gold',
    ink: 'text-gold-ink',
    icon: Warning,
  },
  success: {
    wrap: 'border-success/35 bg-success/8 text-[#9fe0bd]',
    rail: 'bg-success',
    ink: 'text-canvas',
    icon: Check,
  },
  info: {
    wrap: 'border-line-strong bg-white/3 text-fg-muted',
    rail: 'bg-info',
    ink: 'text-canvas',
    icon: Info,
  },
};

export function Alert({
  tone = 'error',
  children,
  action,
}: {
  tone?: keyof typeof TONES;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const style = TONES[tone];
  const Glyph = style.icon;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`animate-rise relative flex flex-wrap items-center gap-3 overflow-hidden rounded-xl border py-3 pl-5 pr-4 text-sm ${style.wrap}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${style.rail}`} />
      <span
        aria-hidden="true"
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${style.rail} ${style.ink}`}
      >
        <Glyph size={12} weight={ICON_WEIGHT} />
      </span>
      <span className="min-w-0 flex-1 leading-relaxed">{children}</span>
      {action}
    </div>
  );
}
