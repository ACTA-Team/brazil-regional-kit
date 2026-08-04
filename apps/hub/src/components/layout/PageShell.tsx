import { cn } from '@/lib/utils';

/**
 * The skeleton every interior page shares: a full-bleed intro band, then a
 * measured column of content.
 *
 * The landing runs edge to edge at 1560px because it is mostly light and
 * photography; a page you have to READ and fill in should not. `narrow` is a
 * single-column form (the ramps), `default` a page of panels and tables.
 *
 * `intro` is rendered OUTSIDE the measured column on purpose — the band carries
 * a halftone landmark that has to reach both edges of the window, and a hero
 * cannot be centred inside a max-width its own section is trying to escape.
 * Passing it as a prop rather than as the first child keeps the page bodies
 * from having to nest one level deeper just to say where the band ends.
 */
const WIDTHS = {
  narrow: 'max-w-2xl',
  default: 'max-w-5xl',
  wide: 'max-w-[1560px]',
} as const;

export function PageShell({
  children,
  intro,
  width = 'default',
  className,
}: {
  children: React.ReactNode;
  /** The full-bleed <PageIntro> band, if this page has one. */
  intro?: React.ReactNode;
  width?: keyof typeof WIDTHS;
  className?: string;
}) {
  return (
    <>
      {intro}
      <div className={cn('mx-auto w-full px-6 py-14 sm:px-10 lg:px-14', WIDTHS[width], className)}>
        {children}
      </div>
    </>
  );
}
