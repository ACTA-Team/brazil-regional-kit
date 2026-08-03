'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { WalletButton } from './WalletButton';

const NAV = [
  { href: '/', key: 'nav.home' },
  { href: '/onramp', key: 'nav.onramp' },
  { href: '/router', key: 'nav.router' },
  { href: '/corridor', key: 'nav.corridor' },
  { href: '/offramp', key: 'nav.offramp' },
  { href: '/x402', key: 'nav.x402' },
] as const;

export function SiteHeader() {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-md bg-linear-to-br from-brand-500 to-accent-500 text-xs font-black text-[#06251a]"
          >
            BR
          </span>
          <span className="text-sm font-semibold tracking-tight">{t('app.name')}</span>
        </Link>

        <nav className="order-3 -mx-1 flex w-full items-center gap-1 overflow-x-auto sm:order-0 sm:mx-0 sm:w-auto">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active ? 'bg-surface-raised text-ink-100' : 'text-ink-400 hover:text-ink-100'
                }`}
              >
                {t(item.key)}
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
