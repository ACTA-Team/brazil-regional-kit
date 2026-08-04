'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { WalletButton } from './WalletButton';

/**
 * The nav is the demo's running order. Numbering it turns a menu into a route:
 * someone who has never seen the app knows where to start and what comes next
 * without being told.
 */
const NAV = [
  { href: '/', key: 'nav.home', step: null },
  { href: '/onramp', key: 'nav.onramp', step: 1 },
  { href: '/router', key: 'nav.router', step: 2 },
  { href: '/corridor', key: 'nav.corridor', step: 3 },
  { href: '/offramp', key: 'nav.offramp', step: 4 },
  { href: '/x402', key: 'nav.x402', step: 5 },
] as const;

export function SiteHeader() {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          {/*
            Restrained by rule 3: the mark is gold-on-dark, not a gold block. A
            solid gold badge up here would compete with the one gold action the
            screen is entitled to.
          */}
          <span
            aria-hidden="true"
            className="grid h-8 w-8 place-items-center rounded-lg border border-gold/45 bg-gold/10 font-mono text-[11px] font-medium text-gold"
          >
            BR
          </span>
          <span className="text-sm font-bold tracking-tight">{t('app.name')}</span>
        </Link>

        <nav className="order-3 -mx-1 flex w-full items-center gap-0.5 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                  active ? 'text-gold' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {item.step ? (
                  <span
                    className={`font-mono text-[10px] transition-colors ${
                      active ? 'text-gold/70' : 'text-fg-subtle'
                    }`}
                  >
                    {item.step}
                  </span>
                ) : null}
                {t(item.key)}
                {/* Active state is gold, per the manual — a bar, not a fill. */}
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2.5 -bottom-[13px] h-0.5 rounded-full bg-gold"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
