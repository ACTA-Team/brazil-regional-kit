'use client';

import { useEffect, useRef } from 'react';
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
 * Halftone plates, one per step. The hero and the corridor band own their own.
 *
 * `position` is the vertical crop, and it is per plate because the band turns a
 * tall portrait into a short landscape strip — the anchor is the ONLY thing
 * deciding what survives. These values are measured rather than guessed: the
 * ink in each plate was profiled by row, and the anchor put on the band that
 * actually holds the subject.
 *
 *   pao-*          peak and ridge carry 40% of the ink across 30-50%
 *   cristo-tall    the widest row — the outstretched arms — sits at 38%
 *   cristo-square  a different framing entirely; the figure sits at 10-40%
 *                  and the widest row down at 91% is the city, not the statue
 *
 * Names say subject and density so a page reads as what it shows. Density
 * matters because the -v2/-v3 pairs are nested subsets of the same dot field,
 * not different treatments: the lighter one is the heavier one with dots
 * removed.
 */
const PLATES = {
  'pao-dense': { src: '/landmarks/pao-dots.png', position: '50% 38%' },
  'pao-light': { src: '/landmarks/pao-dots-v2.png', position: '50% 38%' },
  'cristo-dense': { src: '/landmarks/cristo-dots-v2.png', position: '50% 30%' },
  'cristo-light': { src: '/landmarks/cristo-dots-v3.png', position: '50% 30%' },
  'cristo-square': { src: '/landmarks/cristo-dots.png', position: '50% 22%' },
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
  plate = 'pao-dense',
}: {
  step?: number;
  title: string;
  subtitle: string;
  /** The corridor this page runs, rendered as `from → to` with its rail. */
  route?: { from: string; to: string; rail?: string; anchor?: string };
  /** Which halftone plate sits behind this page. */
  plate?: keyof typeof PLATES;
}) {
  const plateRef = useRef<HTMLImageElement>(null);

  /**
   * Parallax: the plate scrolls slower than the copy over it, so the band reads
   * as having depth instead of being a flat picture that leaves with the page.
   *
   * Written straight to the element rather than through state — this fires on
   * every scroll frame, and re-rendering the whole header to change one
   * transform is work with nothing to show for it. The listener is passive, so
   * it cannot block the scroll it is reacting to.
   */
  useEffect(() => {
    const el = plateRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const apply = () => {
      const band = el.parentElement?.parentElement;
      if (!band) return;
      const rect = band.getBoundingClientRect();
      // 0 when the band's top is at the viewport top, growing as it leaves.
      const travelled = -rect.top / window.innerHeight;
      el.style.transform = `translate3d(0, ${travelled * 56}px, 0) scale(1.12)`;
    };

    apply();
    window.addEventListener('scroll', apply, { passive: true });
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);

  return (
    // A floor on the height, not just padding: pages differ by a route row and
    // a line of subtitle, and without it the band — and so the plate's crop —
    // would be a different shape on every step.
    <section className="relative flex min-h-105 items-center overflow-hidden border-b border-line">
      {/* Two nested layers so the two motions never fight over `transform`: the
          wrapper carries the slow ambient drift, the image carries the scroll
          parallax written by the effect above. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ animation: 'drift 38s ease-in-out infinite' }}
      >
        <img
          ref={plateRef}
          src={PLATES[plate].src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-y-0 right-0 h-full w-[46%] object-cover"
          style={{
            objectPosition: PLATES[plate].position,
            opacity: 0.4,
            // Scaled up so the parallax has somewhere to travel without
            // dragging an edge into frame.
            transform: 'scale(1.12)',
            willChange: 'transform',
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
