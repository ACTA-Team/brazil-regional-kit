'use client';

import { LOCALES, LOCALE_FLAGS, LOCALE_LABELS, useI18n, type Locale } from '@/lib/i18n';

export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-border-subtle bg-surface-inset p-0.5"
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
          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            locale === l ? 'bg-brand-600 text-white' : 'text-ink-400 hover:text-ink-100'
          }`}
        >
          <span aria-hidden="true">{LOCALE_FLAGS[l]}</span>
          <span className="ml-1 uppercase">{l}</span>
        </button>
      ))}
    </div>
  );
}
