'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { House, ICON_WEIGHT } from '@/components/icons';
import { useScroll } from '@/client/use-scroll';
import { MobileNav } from '@/components/layout/mobile-nav';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { WalletButton } from '@/components/wallet/WalletButton';
import { useI18n } from '@/client/i18n';

/**
 * The nav is the demo's running order. Numbering it turns a menu into a route:
 * someone who has never seen the app knows where to start and what comes next
 * without being told. The digits are verde and monospaced so they read as
 * indices rather than as part of the label.
 */
export const navLinks = [
  { key: 'nav.home', href: '/', step: null },
  { key: 'nav.onramp', href: '/onramp', step: 1 },
  { key: 'nav.router', href: '/router', step: 2 },
  { key: 'nav.corridor', href: '/corridor', step: 3 },
  { key: 'nav.offramp', href: '/offramp', step: 4 },
  { key: 'nav.x402', href: '/x402', step: 5 },
] as const;

export function isActivePath(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function Header() {
  const scrolled = useScroll(10);
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <header
      className={cn(
        // The blur is permanent — the header sits over drifting blooms, and a
        // sharp-edged one would cut a hard line through them. Only the tint
        // waits for content to actually be passing underneath.
        'sticky top-0 z-40 w-full border-b border-line backdrop-blur-lg transition-colors',
        scrolled ? 'bg-black/70' : 'bg-transparent',
      )}
    >
      <nav className="mx-auto flex w-full max-w-[1560px] flex-wrap items-center gap-x-8 gap-y-3.5 px-6 py-5 sm:px-10 lg:px-14">
        {/*
          A house instead of a wordmark.

          The brand block was a monogram chip and the words "Brazil Regional
          Kit" — thirty characters restating what the page title already says,
          holding the most valuable position in the header. What that corner is
          actually for is getting back to the start, so it does only that now.
        */}
        <Link
          href="/"
          aria-label={t('nav.home')}
          aria-current={pathname === '/' ? 'page' : undefined}
          // Deliberately not gold when you are already home: the nav's own
          // "overview" link carries that state, and the header is allowed one
          // accent mark, not two.
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line-strong text-fg-muted transition-colors hover:border-gold/30 hover:text-fg"
        >
          <House size={17} weight={ICON_WEIGHT} aria-hidden="true" />
        </Link>

        <div className="hidden min-w-0 flex-wrap items-center gap-x-6 gap-y-3 text-sm md:flex">
          {navLinks.map((link) => {
            const active = isActivePath(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-baseline gap-1.5 whitespace-nowrap transition-colors',
                  active
                    ? // Active is a hairline under the label, not a pill: the
                      // header must never look like it holds a button.
                      'border-b border-gold pb-1 text-fg'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                {link.step ? (
                  <span className="font-mono text-[11px] text-verde">{link.step}</span>
                ) : null}
                {t(link.key)}
              </Link>
            );
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
          <LocaleSwitcher />
          <WalletButton />
          <MobileNav />
        </div>
      </nav>
    </header>
  );
}
