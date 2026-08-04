/**
 * The demo's running order, in one place.
 *
 * Two surfaces render these numbers — the nav digits in the header and the
 * `01 / 06` eyebrow at the top of each page — and they used to hold their own
 * copies. Reordering the nav then left every page hero claiming a different
 * step than the link that got you there. The order lives here now, and both
 * surfaces read it.
 */
export const navLinks = [
  { key: 'nav.home', href: '/', step: null },
  { key: 'nav.identity', href: '/identity', step: 1 },
  { key: 'nav.onramp', href: '/onramp', step: 2 },
  { key: 'nav.router', href: '/router', step: 3 },
  { key: 'nav.corridor', href: '/corridor', step: 4 },
  { key: 'nav.offramp', href: '/offramp', step: 5 },
  { key: 'nav.x402', href: '/x402', step: 6 },
] as const;

/** How many numbered steps the demo has — the denominator in `01 / 06`. */
export const TOTAL_STEPS = navLinks.filter((link) => link.step !== null).length;

export function isActivePath(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/**
 * Which step of the demo a path belongs to, or `null` for anything outside the
 * running order (the overview, and any page that never joined it).
 */
export function stepFor(pathname: string): number | null {
  const match = navLinks.find((link) => link.step !== null && isActivePath(pathname, link.href));
  return match?.step ?? null;
}
