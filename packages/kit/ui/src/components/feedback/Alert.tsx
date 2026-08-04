'use client';

import { Check, ICON_WEIGHT, Info, Warning, X, type Icon } from '../../internal/icons';

/**
 * Feedback, in the app's four semantic colours.
 *
 * Hairlines, not fills — the same rule the cards follow. Each tone is a 1px
 * tinted border over an 8% wash and an icon in the tone's own colour; an
 * earlier version painted a solid rail and a filled icon disc, which put more
 * saturated colour on screen than the gold button beside it and inverted the
 * hierarchy every time an alert appeared.
 *
 * Three slots, and the middle one is what makes this usable:
 *
 *   title   names the situation in the user's words
 *   body    says whose problem it is and what happens next
 *   detail  the raw technical text, folded away behind a disclosure
 *
 * The detail slot exists because the alternative to a wall of anchor jargon is
 * not silence. This demo is watched by people who want to verify the
 * integration, and a support conversation needs the real string — so it is
 * demoted, never deleted.
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
  title,
  children,
  detail,
  detailLabel = 'Technical detail',
  action,
}: {
  tone?: keyof typeof TONES;
  /** Names the situation. Without it this renders as a plain one-line alert. */
  title?: React.ReactNode;
  children: React.ReactNode;
  /** Raw technical text, shown folded. */
  detail?: string | null;
  detailLabel?: string;
  action?: React.ReactNode;
}) {
  const style = TONES[tone];
  const Glyph = style.icon;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`animate-rise relative overflow-hidden rounded-xl border px-4 py-3.5 text-sm text-fg-muted ${style.wrap}`}
      style={{
        background: `radial-gradient(120% 140% at 0% 50%, ${style.glow}, transparent 62%), linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01))`,
      }}
    >
      <div className="flex flex-wrap items-start gap-x-3.5 gap-y-3">
        <Glyph
          aria-hidden="true"
          size={16}
          weight={ICON_WEIGHT}
          // Nudged onto the first line's baseline: the icon aligns to the title
          // when there is one, and to the body when there is not.
          className={`mt-0.5 shrink-0 ${style.ink}`}
        />

        <div className="min-w-0 flex-1">
          {title ? <p className="font-semibold text-fg">{title}</p> : null}
          <div className={title ? 'mt-1 leading-relaxed' : 'leading-relaxed'}>{children}</div>

          {detail ? (
            <details className="group mt-2.5">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-mono text-[11px] text-fg-subtle transition-colors hover:text-fg">
                <span
                  aria-hidden="true"
                  className="inline-block transition-transform group-open:rotate-90"
                >
                  ›
                </span>
                {detailLabel}
              </summary>
              <pre className="well mt-2 max-h-40 overflow-auto p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap text-fg-subtle">
                {detail}
              </pre>
            </details>
          ) : null}
        </div>

        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
