'use client';

import { createContext, useContext, useMemo } from 'react';
import { DEFAULT_STRINGS } from './strings.generated';

/**
 * How these components get their words and number formats.
 *
 * The design goal is that both ends of the spectrum work. Drop a component into
 * a page with no setup and it renders readable English, because the strings
 * ship inside the package. Wrap the tree in `<RampUIProvider t={...}>` and
 * every label comes from your own dictionary instead, with no component API
 * changes and no per-label props to thread.
 *
 * That matters more than it sounds for a ramp kit: the whole point of a
 * regional toolkit is that the app around it speaks Portuguese or Spanish, and
 * a component library that can only be localised by forking it is not reusable.
 */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

interface RampUIValue {
  t: Translate;
  /** BCP-47 tag driving Intl number and currency formatting. */
  locale: string;
}

const RampUIContext = createContext<RampUIValue | null>(null);

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Falls back to the key itself, so a missing string is visible, not invisible. */
const defaultTranslate: Translate = (key, params) =>
  interpolate(DEFAULT_STRINGS[key] ?? key, params);

export function RampUIProvider({
  t,
  locale = 'en-US',
  children,
}: {
  /** Your dictionary. Omit it and the package's built-in English is used. */
  t?: Translate;
  locale?: string;
  children: React.ReactNode;
}) {
  const value = useMemo<RampUIValue>(() => ({ t: t ?? defaultTranslate, locale }), [t, locale]);
  return <RampUIContext.Provider value={value}>{children}</RampUIContext.Provider>;
}

/**
 * Works with or without a provider. A component used outside one still renders
 * English rather than throwing, which is what makes a single import enough to
 * see something on screen.
 */
export function useRampUI(): RampUIValue {
  return useContext(RampUIContext) ?? { t: defaultTranslate, locale: 'en-US' };
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** `R$ 500,00` in pt-BR, `$500.00` in es-MX. Amounts arrive as decimal strings. */
export function formatMoney(amount: string, currency: string, locale: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // Unknown currency code (TESOURO, USDC) — fall back to a plain number.
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(n)} ${currency}`;
  }
}

/**
 * Token amounts, capped at four decimals.
 *
 * Anchors quote to seven. A comparison table asking someone to weigh
 * `97.7587963` against `92.2275141` is working against the only judgement it
 * exists to support; the underlying strings are never rounded, only the display.
 */
export function formatToken(amount: string, code: string, locale: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${code}`;
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n)} ${code}`;
}
