'use client';

import { useEffect, useRef } from 'react';

/**
 * The Cristo, dissolving as you leave the hero.
 *
 * Four halftone plates stacked on top of one another. Scrolling fades them out
 * one after the other on a stagger, so the statue thins rather than dimming —
 * the dots disappear in waves instead of the whole image losing opacity at once.
 *
 * Written against the DOM rather than React state on purpose: this runs on every
 * scroll frame, and re-rendering four <img>s sixty times a second to change one
 * number each is work with nothing to show for it. The listener is passive, so
 * it can never block the scroll itself.
 */

/** Fraction of the fade each plate waits before it starts going. */
const STAGGER = [0, 0.12, 0.26, 0.42];
const BASE_OPACITY = 0.92;
/** The whole dissolve completes within three quarters of a viewport. */
const TRAVEL = 0.75;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function CristoLayers({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const layers = Array.from(root.querySelectorAll<HTMLImageElement>('[data-plate]'));

    const apply = () => {
      const t = clamp01(window.scrollY / (window.innerHeight * TRAVEL));
      for (const layer of layers) {
        const k = Number(layer.dataset.plate);
        const start = STAGGER[k] ?? 0;
        const progress = clamp01((t - start) / (1 - start));
        layer.style.opacity = String(BASE_OPACITY * (1 - progress));
      }
    };

    // Restored scroll positions land mid-dissolve; paint the right frame first.
    apply();
    window.addEventListener('scroll', apply, { passive: true });
    return () => window.removeEventListener('scroll', apply);
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '720px',
        justifySelf: 'end',
        aspectRatio: '1122 / 1402',
        maxHeight: '82vh',
        pointerEvents: 'none',
      }}
    >
      {/* A verde bloom behind the plates, so the halftone reads as lit from
          within rather than pasted onto the background. */}
      <div
        style={{
          position: 'absolute',
          inset: '16%',
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 50% 42%, oklch(0.55 0.12 152 / 0.22), transparent 68%)',
          filter: 'blur(80px)',
        }}
      />
      {STAGGER.map((_, k) => (
        <img
          key={k}
          data-plate={k}
          src={`/landmarks/cristo-layer-${k}.png`}
          alt=""
          /* The hero is the first thing painted; nothing here is below the fold. */
          fetchPriority={k === 0 ? 'high' : undefined}
          decoding="async"
          style={{
            position: 'absolute',
            inset: '-14%',
            width: '128%',
            height: '128%',
            objectFit: 'contain',
            opacity: BASE_OPACITY,
            willChange: 'opacity',
          }}
        />
      ))}
    </div>
  );
}
