'use client';

import { LOCALES, LOCALE_LABELS, useI18n, type Locale } from '@/client/i18n';

/**
 * Language switch.
 *
 * Codes, not flags. A flag names a country, not a language: Portuguese is not
 * Brazil, Spanish is not Mexico, and English is not the United States. The
 * two-letter code is also the only version that renders identically on every
 * platform and reads correctly to a screen reader through the title.
 *
 * A segmented pill rather than three buttons: the choice is one of three, and
 * the shape should say so. The active segment is a 7%-white wash — the header
 * has no accent colour to spend, and gold here would compete with whatever
 * primary action the page below is offering.
 */
export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-line-strong p-0.75 font-mono text-[11px]"
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
          className={`rounded-full px-2.75 py-1.25 uppercase transition-colors ${
            locale === l ? 'bg-white/7 text-fg' : 'text-fg-subtle hover:text-fg'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
