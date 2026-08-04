'use client';

import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react';

/**
 * Scroll reveal: fade up out of a blur, once, when the element comes into view.
 *
 * One shared IntersectionObserver for the whole page rather than one per
 * element — a landing page has thirty of these, and thirty observers is thirty
 * separate callbacks the browser has to schedule. Elements unobserve themselves
 * after revealing, so the observer empties out as the page is read.
 *
 * Two cases the naive version gets wrong, both handled here:
 *
 *   · an element ALREADY scrolled past on load (deep link, restored scroll
 *     position, back navigation) never intersects, so it would stay invisible
 *     forever. `boundingClientRect.bottom < 0` catches it on the first callback.
 *   · no JavaScript at all. The hidden state is inline, so the layout ships a
 *     <noscript> rule that clears it — the page reads fine, just without the
 *     entrance.
 */

let observer: IntersectionObserver | null = null;

/**
 * The resting state is written inline (so it is correct on the very first
 * paint, before hydration), and inline beats a class — so the reveal clears the
 * same three properties inline rather than adding a class that would lose.
 */
function reveal(el: Element) {
  const style = (el as HTMLElement).style;
  style.opacity = '1';
  style.transform = 'none';
  style.filter = 'blur(0px)';
  observer?.unobserve(el);
}

function getObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // Intersecting, or already above the viewport — either way it is due.
        if (entry.isIntersecting || entry.boundingClientRect.bottom < 0) {
          reveal(entry.target);
        }
      }
    },
    // The -12% bottom inset holds the reveal back until the element is properly
    // on screen rather than firing on the first pixel of it.
    { rootMargin: '0px 0px -12% 0px', threshold: [0, 0.15] },
  );
  return observer;
}

export function Reveal({
  children,
  as: Tag = 'div',
  delay = 0,
  className,
  style,
  ...rest
}: {
  children: ReactNode;
  /** Rendered element. Use `section`/`article`/`li` to keep the outline honest. */
  as?: ElementType;
  /** Stagger, in ms — for a grid whose cards should not all land at once. */
  delay?: number;
  className?: string;
  /**
   * Merged UNDER the resting state, never spread over it: a caller passing a
   * text-shadow must not silently replace the opacity/transform/filter that
   * make this component a reveal at all.
   */
  style?: CSSProperties;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // An observer fires its callback once on observe(), so anything already on
    // screen reveals without waiting for a scroll that may never come.
    const io = getObserver();
    io.observe(el);
    return () => io.unobserve(el);
  }, []);

  return (
    <Tag
      ref={ref}
      data-reveal=""
      className={className}
      style={{
        ...style,
        opacity: 0,
        transform: 'translateY(26px)',
        filter: 'blur(6px)',
        transition:
          'opacity 800ms cubic-bezier(0.22,1,0.36,1), transform 800ms cubic-bezier(0.22,1,0.36,1), filter 800ms ease',
        transitionDelay: delay ? `${delay}ms` : undefined,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
