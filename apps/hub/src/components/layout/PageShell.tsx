'use client';

import { Children, isValidElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Reveal } from '@/components/layout/Reveal';

/**
 * The skeleton every interior page shares: a full-bleed intro band, then a
 * measured column of content that arrives as you scroll to it.
 *
 * The landing runs edge to edge at 1560px because it is mostly light and
 * photography; a page you have to READ and fill in should not. `narrow` is a
 * single-column form (the ramps), `default` a page of panels and tables.
 *
 * `intro` is rendered OUTSIDE the measured column on purpose — the band carries
 * a halftone landmark that has to reach both edges of the window, and a hero
 * cannot be centred inside a max-width its own section is trying to escape.
 *
 * The reveal lives here rather than in each page because it has to apply to
 * panels that do not exist yet: an order card, a deposit panel and a receipt
 * all appear mid-flow, minutes apart, and each should arrive the same way the
 * form above it did. Wrapping at the shell means a page gets that by existing,
 * and cannot forget to.
 */
const WIDTHS = {
  narrow: 'max-w-2xl',
  default: 'max-w-5xl',
  wide: 'max-w-[1560px]',
} as const;

/** Enough to read as a sequence, short enough not to feel like waiting. */
const STAGGER_MS = 70;
/** Past this the delay stops accumulating — nothing should wait a full second. */
const MAX_STAGGERED = 6;

export function PageShell({
  children,
  intro,
  width = 'default',
  className,
  animate = true,
}: {
  children: ReactNode;
  /** The full-bleed <PageIntro> band, if this page has one. */
  intro?: ReactNode;
  width?: keyof typeof WIDTHS;
  className?: string;
  /** Opt out for a page that manages its own entrances. */
  animate?: boolean;
}) {
  // Only real elements are wrapped. A page renders plenty of `null` and `false`
  // from its conditionals, and wrapping those would emit empty animated boxes
  // that still occupy a row of the parent's `space-y`.
  let staggered = 0;
  const body = animate
    ? Children.map(children, (child) => {
        if (!isValidElement(child)) return child;
        const delay = Math.min(staggered++, MAX_STAGGERED) * STAGGER_MS;
        return <Reveal delay={delay}>{child}</Reveal>;
      })
    : children;

  return (
    <>
      {intro}
      <div className={cn('mx-auto w-full px-6 py-14 sm:px-10 lg:px-14', WIDTHS[width], className)}>
        {body}
      </div>
    </>
  );
}
