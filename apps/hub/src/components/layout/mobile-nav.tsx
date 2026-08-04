'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Portal, PortalBackdrop } from '@/components/layout/portal';
import { isActivePath, navLinks } from '@/lib/nav';
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
        <Portal className="top-16" id="mobile-menu">
          <PortalBackdrop />
          <div
            className={cn(
              'data-[slot=open]:zoom-in-97 ease-out data-[slot=open]:animate-in',
              'size-full p-4',
            )}
            data-slot={open ? 'open' : 'closed'}
          >
            <div className="grid gap-y-1">
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
