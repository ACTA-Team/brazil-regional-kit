'use client';

import { useEffect, useState } from 'react';

/**
 * True once the page has scrolled past `threshold` pixels.
 *
 * Implemented with an IntersectionObserver watching a zero-height sentinel
 * rather than a scroll listener. A `scroll` listener fires on every frame the
 * user moves, on the main thread, to answer a question whose value changes
 * twice per session. The observer answers the same question by being told,
 * costs nothing while idle, and cannot jank the page.
 *
 * The sentinel is created and removed by the hook, so callers only see a
 * boolean.
 */
export function useScroll(threshold: number) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = `position:absolute;top:${threshold}px;left:0;height:1px;width:1px;pointer-events:none;`;
    document.body.appendChild(sentinel);

    // The sentinel leaving the viewport from the top means we scrolled past it.
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setScrolled(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      sentinel.remove();
    };
  }, [threshold]);

  return scrolled;
}
