'use client';

import { ArrowRight, ICON_WEIGHT } from '@/components/icons';

/**
 * One header shape for every page in the demo.
 *
 * It is the landing's corridor band, reused at interior scale: a full-bleed
 * strip with a halftone landmark falling off into the black, a verde bloom, and
 * the page's own copy over it. The interior pages used to be a form on a flat
 * background under a header that was all light and photography — same product,
 * two visual worlds. This is what closes that gap.
 *
 * Each step gets a DIFFERENT plate, always in the same place. Someone clicking
 * through the demo gets a landmark that changes under a layout that does not,
 * which is a cheap and legible way to say "you moved" without a progress bar.
 *
 * Every page still answers the same three questions in the same three places:
 * which step of the demo this is, what it does, and which corridor it runs on.
 */

/**
 * Halftone plates, one per step. The corridor and hero own the other two.
 *
 * `position` is the crop, and it is per plate rather than shared because the
 * subjects are not framed alike. Both source images are tall portraits being
 * cropped into a short landscape band, so the vertical anchor decides what
 * survives: the Cristo's head and outstretched arms sit in the top fifth of
 * its frame and get cut off at anything near centre, while Pão de Açúcar's
 * peak sits closer to the middle of its own.
 */
const PLATES = {
  'cristo-a': { src: '/landmarks/cristo-dots.png', position: '50% 14%' },
  'cristo-b': { src: '/landmarks/cristo-dots-v2.png', position: '50% 14%' },
  'cristo-c': { src: '/landmarks/cristo-dots-v3.png', position: '50% 14%' },
  'pao-a': { src: '/landmarks/pao-dots.png', position: '50% 38%' },
  'pao-b': { src: '/landmarks/pao-dots-v2.png', position: '50% 38%' },
} as const;

/** The three masks the corridor band uses, intersected: no edges, only falloff. */
const PLATE_MASK = [
  'radial-gradient(70% 70% at 60% 50%, #000 26%, transparent 90%)',
  'linear-gradient(to right, transparent 0%, #000 22%, #000 82%, transparent 100%)',
  'linear-gradient(to bottom, transparent 0%, #000 14%, #000 76%, transparent 100%)',
].join(', ');

const TOTAL_STEPS = 5;

export function PageIntro({
  step,
  title,
  subtitle,
  route,
  plate = 'cristo-a',
}: {
  step?: number;
  title: string;
  subtitle: string;
  /** The corridor this page runs, rendered as `from → to` with its rail. */
  route?: { from: string; to: string; rail?: string; anchor?: string };
  /** Which halftone plate sits behind this page. */
  plate?: keyof typeof PLATES;
}) {
  return (
    // A floor on the height, not just padding: pages differ by a route row and
    // a line of subtitle, and without it the band — and so the plate's crop —
    // would be a different shape on every step.
    <section className="relative flex min-h-105 items-center overflow-hidden border-b border-line">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <img
          src={PLATES[plate].src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-y-0 right-0 h-full w-[46%] object-cover"
          style={{
            objectPosition: PLATES[plate].position,
            opacity: 0.4,
            maskImage: PLATE_MASK,
            WebkitMaskImage: PLATE_MASK,
            maskComposite: 'intersect',
            WebkitMaskComposite: 'source-in',
          }}
        />
        {/* Pulls the plate back to black wherever the copy runs, so the halftone
            never competes with a word of it. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, #000 22%, rgba(0,0,0,0.55) 52%, transparent 82%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(90% 120% at 8% 50%, oklch(0.52 0.13 152 / 0.16), transparent 62%)',
            filter: 'blur(40px)',
          }}
        />
      </div>

      <header className="animate-rise relative mx-auto w-full max-w-[1560px] px-6 pt-14 pb-12 sm:px-10 lg:px-14">
        {step ? (
          // The landing's eyebrow, carrying the running order instead of the
          // region: same dash, same mono, same verde.
          <p className="flex items-center gap-3 font-mono text-xs tracking-[0.18em] text-verde">
            <span aria-hidden="true" className="inline-block h-px w-6.5 bg-verde" />
            {String(step).padStart(2, '0')}
            <span className="text-fg-subtle">/ {String(TOTAL_STEPS).padStart(2, '0')}</span>
          </p>
        ) : null}

        <h1 className="mt-5 max-w-[15ch] text-[clamp(30px,3.8vw,52px)] leading-[1.02] font-semibold tracking-[-0.04em]">
          {title}
        </h1>

        <p className="mt-5 max-w-xl leading-relaxed text-fg-muted">{subtitle}</p>

        {route ? (
          <div className="mt-7 flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span className="well px-2 py-1 text-fg">{route.from}</span>
            <ArrowRight size={12} weight={ICON_WEIGHT} className="text-verde" aria-hidden="true" />
            <span className="well px-2 py-1 text-fg">{route.to}</span>
            {route.rail ? <span className="chip chip-neutral">{route.rail}</span> : null}
            {route.anchor ? <span className="chip chip-neutral">{route.anchor}</span> : null}
          </div>
        ) : null}
      </header>
    </section>
  );
}
