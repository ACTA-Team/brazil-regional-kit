'use client';

/**
 * Three-locale dictionary i18n.
 *
 * Deliberately hand-rolled instead of next-intl: this app needs string lookup
 * and a switcher, not locale-prefixed routing, middleware or per-locale static
 * generation. Missing keys fall back to English rather than rendering the raw
 * key, so a half-translated locale degrades quietly instead of shouting
 * `corridor.recipient.title` at a judge.
 */

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import en from '@/messages/en.json';
import pt from '@/messages/pt.json';
import es from '@/messages/es.json';

export const LOCALES = ['pt', 'es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Brazil-first: the bounty's home market opens in Portuguese. */
export const DEFAULT_LOCALE: Locale = 'pt';

const STORAGE_KEY = 'brk.locale';

export const LOCALE_LABELS: Record<Locale, string> = {
  pt: 'Português',
  es: 'Español',
  en: 'English',
};

/** Intl tags, for number and date formatting. */
const INTL_TAG: Record<Locale, string> = {
  pt: 'pt-BR',
  es: 'es-MX',
  en: 'en-US',
};

type Dictionary = Record<string, string>;

const DICTIONARIES: Record<Locale, Dictionary> = {
  en: en as Dictionary,
  pt: pt as Dictionary,
  es: es as Dictionary,
};

export type Translate = (key: string, params?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translate;
  /** Intl tag for the active locale, e.g. `pt-BR`. */
  tag: string;
}

const I18nContext = createContext<I18nValue | null>(null);

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * The stored locale is external state that React does not own, which is exactly
 * what `useSyncExternalStore` exists for. Reading it in an effect and calling
 * `setState` would work, but it costs a second render on every page load and
 * makes the first paint show the wrong language for a frame.
 *
 * `getServerSnapshot` returns the default so server and client agree on the
 * first render, and hydration then picks up the stored preference.
 */
const localeListeners = new Set<() => void>();

function subscribeToLocale(onChange: () => void): () => void {
  localeListeners.add(onChange);
  // Keep other tabs in sync too.
  window.addEventListener('storage', onChange);
  return () => {
    localeListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function readLocale(): Locale {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && (LOCALES as readonly string[]).includes(stored)
    ? (stored as Locale)
    : DEFAULT_LOCALE;
}

const readServerLocale = (): Locale => DEFAULT_LOCALE;

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribeToLocale, readLocale, readServerLocale);

  const setLocale = useCallback((next: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = INTL_TAG[next];
    for (const listener of localeListeners) listener();
  }, []);

  const t = useCallback<Translate>(
    (key, params) => {
      const dict = DICTIONARIES[locale];
      const value = dict[key] ?? DICTIONARIES.en[key] ?? key;
      return interpolate(value, params);
    },
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t, tag: INTL_TAG[locale] }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

// ── Locale-aware formatting ───────────────────────────────────────────────────

/** `R$ 500,00` in pt-BR, `$500.00` in es-MX. Amounts arrive as decimal strings. */
export function formatMoney(amount: string, currency: string, tag: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(tag, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // Unknown currency code (TESOURO, USDC) — fall back to a plain number.
    return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 7 }).format(n)} ${currency}`;
  }
}

/** Token amounts: no currency symbol, up to 7 decimals, trailing zeros trimmed. */
export function formatToken(amount: string, code: string, tag: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${code}`;
  return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 7 }).format(n)} ${code}`;
}
