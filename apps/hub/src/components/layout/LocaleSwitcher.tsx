'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CaretDown, Check, Globe, ICON_WEIGHT } from '@/components/icons';
import { LOCALES, LOCALE_LABELS, useI18n, type Locale } from '@/client/i18n';

/**
 * Language switch.
 *
 * Names, not flags and not codes. A flag names a country rather than a
 * language — Portuguese is not Brazil, Spanish is not Mexico — and a bare `PT`
 * asks the reader to decode an abbreviation before they can choose. "Português"
 * needs no decoding, which is the entire point of a language switch: the person
 * who needs it is, by definition, reading a language they do not want.
 *
 * It collapses to a globe because three permanently visible segments spent
 * header width on a control most people touch once per session, and never
 * again.
 */
export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Any click outside, or Escape, dismisses it — a menu that can only be closed
  // by choosing something traps a user who opened it to look.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const choose = (next: Locale) => {
    setLocale(next);
    close();
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={LOCALE_LABELS[locale]}
        className={`flex items-center gap-1.5 rounded-full border py-1.5 pl-2.5 pr-2 text-xs transition-colors ${
          open
            ? 'border-gold/40 bg-white/6 text-fg'
            : 'border-line-strong text-fg-muted hover:border-gold/30 hover:text-fg'
        }`}
      >
        <Globe size={15} weight={ICON_WEIGHT} aria-hidden="true" />
        <span className="font-mono uppercase tracking-wide">{locale}</span>
        <CaretDown
          size={10}
          weight={ICON_WEIGHT}
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-in fade-in zoom-in-95 absolute right-0 top-[calc(100%+0.5rem)] z-50 w-44 overflow-hidden rounded-xl border border-line-strong bg-surface p-1 shadow-2xl shadow-black/50 duration-150"
        >
          {LOCALES.map((l: Locale) => {
            const active = l === locale;
            return (
              <button
                key={l}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => choose(l)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  active ? 'bg-white/6 text-fg' : 'text-fg-muted hover:bg-white/4 hover:text-fg'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-fg-subtle">
                    {l}
                  </span>
                  {LOCALE_LABELS[l]}
                </span>
                {active ? (
                  <Check size={13} weight={ICON_WEIGHT} aria-hidden="true" className="text-gold" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
