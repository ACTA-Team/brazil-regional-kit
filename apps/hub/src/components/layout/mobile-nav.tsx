'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Portal, PortalBackdrop } from '@/components/layout/portal';
import { isActivePath, navLinks } from '@/components/layout/header';
import { ICON_WEIGHT, List, X } from '@/components/icons';
import { useI18n } from '@/client/i18n';

/**
 * The same numbered running order as the desktop nav, stacked.
 *
 * Tapping a link closes the sheet: on mobile the panel covers the page it just
 * navigated to, so leaving it open would hide the destination.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <Button
        aria-controls="mobile-menu"
        aria-expanded={open}
        aria-label="Toggle menu"
        onClick={() => setOpen(!open)}
        size="icon"
        variant="outline"
      >
        {open ? <X size={18} weight={ICON_WEIGHT} /> : <List size={18} weight={ICON_WEIGHT} />}
      </Button>

      {open ? (
        <Portal id="mobile-menu" role="dialog" aria-modal="true" aria-label={t('nav.home')}>
          <PortalBackdrop className="bg-background/98 supports-backdrop-filter:bg-background/88" />
          <div
            className={cn(
              'data-[slot=open]:fade-in data-[slot=open]:slide-in-from-top-2 ease-out data-[slot=open]:animate-in',
              'size-full px-5 pt-24 pb-8',
            )}
            data-slot={open ? 'open' : 'closed'}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute top-5 right-5 grid h-11 w-11 place-items-center rounded-xl border border-line-strong bg-surface text-fg-muted transition-colors hover:border-gold/35 hover:text-fg"
            >
              <X size={18} weight={ICON_WEIGHT} aria-hidden="true" />
            </button>

            <div className="grid gap-y-1 rounded-2xl border border-line-strong bg-surface/95 p-2 shadow-2xl shadow-black/40">
              {navLinks.map((link) => {
                const active = isActivePath(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-3.5 py-3 text-base transition-colors',
                      active
                        ? 'border-gold/40 bg-gold/8 text-fg'
                        : 'border-transparent text-fg-muted hover:bg-white/5 hover:text-fg',
                    )}
                  >
                    {/* Verde digits, same as the desktop nav: the number is an
                        index into the demo, not part of the label. */}
                    <span
                      className={cn('w-4 font-mono text-xs', active ? 'text-gold' : 'text-verde')}
                    >
                      {link.step ?? ''}
                    </span>
                    {t(link.key)}
                  </Link>
                );
              })}
            </div>
          </div>
        </Portal>
      ) : null}
    </div>
  );
}
