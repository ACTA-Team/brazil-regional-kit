'use client';

import { ArrowRight, ICON_WEIGHT } from './icons';

/**
 * One header shape for every page in the demo.
 *
 * Each page answers the same three questions in the same three places: which
 * step of the demo this is, what it does, and which corridor it runs on. Once
 * a visitor has read one page header they can skim the rest — consistency is
 * the cheapest comprehension there is.
 *
 * The step number sits inline with the title rather than on its own label line
 * above it. Same wayfinding, one less stacked micro-label, and the title stays
 * the first thing the eye lands on.
 */
export function PageIntro({
  step,
  title,
  subtitle,
  route,
}: {
  step?: number;
  title: string;
  subtitle: string;
  /** The corridor this page runs, rendered as `from → to` with its rail. */
  route?: { from: string; to: string; rail?: string; anchor?: string };
}) {
  return (
    <header className="animate-rise">
      <div className="flex items-center gap-3">
        {step ? (
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gold/45 bg-gold/10 font-mono text-sm text-gold"
          >
            {step}
          </span>
        ) : null}
        <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">{title}</h1>
      </div>

      <p className="mt-3 max-w-2xl leading-relaxed text-fg-muted">{subtitle}</p>

      {route ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="well px-2 py-1 text-fg">{route.from}</span>
          <ArrowRight size={13} weight={ICON_WEIGHT} className="text-gold" aria-hidden="true" />
          <span className="well px-2 py-1 text-fg">{route.to}</span>
          {route.rail ? <span className="chip chip-neutral">{route.rail}</span> : null}
          {route.anchor ? <span className="chip chip-neutral">{route.anchor}</span> : null}
        </div>
      ) : null}
    </header>
  );
}
