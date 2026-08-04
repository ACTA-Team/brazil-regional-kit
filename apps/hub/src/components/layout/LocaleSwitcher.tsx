'use client';

import { LOCALES, LOCALE_LABELS, useI18n, type Locale } from '@/client/i18n';

/**
 * Language switch.
 *
 * Codes, not flags. A flag names a country, not a language: Portuguese is not
 * Brazil, Spanish is not Mexico, and English is not the United States. The
 * two-letter code is also the only version that renders identically on every
 * platform and reads correctly to a screen reader through the title.
 */
export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-line bg-inset p-0.5"
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((l: Locale) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          title={LOCALE_LABELS[l]}
          className={`rounded-md px-2 py-1 text-xs font-semibold uppercase transition-colors ${
            /* Active state is gold: a tint, not a fill, so it never reads as
               the screen's primary action. */
            locale === l ? 'bg-gold/15 text-gold' : 'text-fg-subtle hover:text-fg'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
