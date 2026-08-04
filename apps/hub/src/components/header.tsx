'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/logo';
import { useScroll } from '@/hooks/use-scroll';
import { MobileNav } from '@/components/mobile-nav';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { WalletButton } from '@/components/WalletButton';
import { useI18n } from '@/lib/i18n';

/**
 * The nav is the demo's running order. Numbering it turns a menu into a route:
 * someone who has never seen the app knows where to start and what comes next
 * without being told.
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
        // `sticky` already establishes the positioning context the flag rule
        // below anchors to, so no `relative` is needed (and it would conflict).
        'sticky top-0 z-50 w-full border-b border-transparent transition-colors',
        {
          // Border and blur appear only once content is passing underneath, so
          // the header is a plain part of the page until it has a job to do.
          'border-border bg-background/85 backdrop-blur-xl': scrolled,
        },
      )}
    >
      <span aria-hidden="true" className="flag-rule absolute inset-x-0 top-0 h-[3px]" />

      <nav className="mx-auto flex h-16 w-full max-w-5xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0 rounded-lg" aria-label="Brazil Regional Kit">
          <Logo className="hidden sm:flex" />
          <Logo className="sm:hidden" showWordmark={false} />
        </Link>

        <div className="ml-auto hidden items-center gap-0.5 md:flex">
          {navLinks.map((link) => {
            const active = isActivePath(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                  active ? 'text-gold' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {link.step ? (
                  <span
                    className={cn(
                      'font-mono text-[10px] transition-colors',
                      active ? 'text-gold/70' : 'text-fg-subtle',
                    )}
                  >
                    {link.step}
                  </span>
                ) : null}
                {t(link.key)}
                {/* Active state is gold, per the manual: a bar, not a fill. */}
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2.5 -bottom-[9px] h-0.5 rounded-full bg-gold"
                  />
                ) : null}
              </Link>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2 md:ml-4">
          <LocaleSwitcher />
          <WalletButton />
          <MobileNav />
        </div>
      </nav>
    </header>
  );
}
