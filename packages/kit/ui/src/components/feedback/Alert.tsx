'use client';

import { Check, ICON_WEIGHT, Info, Warning, X, type Icon } from '../../internal/icons';

/**
 * Feedback, in the app's four semantic colours.
 *
 * Hairlines, not fills — the same rule the cards follow. Each tone is a 1px
 * tinted border over an 8% wash and an icon in the tone's own colour; the
 * earlier version painted a solid rail and a filled icon disc, which put more
 * saturated colour on screen than the gold button beside it and inverted the
 * hierarchy every time an alert appeared.
 *
 * `glow` is the tone's bloom, applied like the cards' — a radial that lights
 * the left edge and dies out well before the text.
 */
const TONES: Record<
  'error' | 'warning' | 'success' | 'info',
  { wrap: string; ink: string; glow: string; icon: Icon }
> = {
  error: {
    wrap: 'border-danger/35',
    ink: 'text-danger',
    glow: 'oklch(0.68 0.2 22 / 12%)',
    icon: X,
  },
  warning: {
    wrap: 'border-gold/35',
    ink: 'text-gold',
    glow: 'oklch(0.86 0.17 96 / 12%)',
    icon: Warning,
  },
  success: {
    wrap: 'border-verde/35',
    ink: 'text-verde',
    glow: 'oklch(0.72 0.17 152 / 12%)',
    icon: Check,
  },
  info: {
    wrap: 'border-line-strong',
    ink: 'text-fg-subtle',
    glow: 'rgba(255,255,255,0.05)',
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
      className={`animate-rise relative flex flex-wrap items-center gap-3.5 overflow-hidden rounded-xl border px-4 py-3.5 text-sm text-fg-muted ${style.wrap}`}
      style={{
        background: `radial-gradient(120% 140% at 0% 50%, ${style.glow}, transparent 62%), linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01))`,
      }}
    >
      <Glyph
        aria-hidden="true"
        size={16}
        weight={ICON_WEIGHT}
        className={`shrink-0 ${style.ink}`}
      />
      <span className="min-w-0 flex-1 leading-relaxed">{children}</span>
      {action}
    </div>
  );
}
