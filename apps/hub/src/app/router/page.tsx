'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BRL, MXN, TESOURO, USDC, USD, type AssetId, type CountryCode } from '@brk/ramp-core';
import type { AnchorResult } from '@brk/ramp-router';
import { Alert } from '@/components/Alert';
import { AmountField } from '@/components/AmountField';
import { QuoteTable, type PublicRankedQuote } from '@/components/QuoteTable';
import { SepAuthPanel } from '@/components/SepAuthPanel';
import { useI18n } from '@/lib/i18n';

const SELLABLE: Array<{ asset: AssetId; label: string; presets: string[] }> = [
  { asset: BRL, label: 'BRL', presets: ['100', '250', '500', '1000'] },
  { asset: USDC, label: 'USDC', presets: ['25', '50', '100', '500'] },
  { asset: TESOURO, label: 'TESOURO', presets: ['50', '100', '250', '500'] },
  { asset: MXN, label: 'MXN', presets: ['500', '1000', '5000', '10000'] },
];

const COUNTRIES: Array<{ code: CountryCode | ''; label: string }> = [
  { code: '', label: 'router.anywhere' },
  { code: 'BR', label: 'Brasil' },
  { code: 'MX', label: 'México' },
  { code: 'AR', label: 'Argentina' },
  { code: 'CL', label: 'Chile' },
  { code: 'CO', label: 'Colombia' },
  { code: 'US', label: 'United States' },
];

const DESTINATIONS: Array<{ asset: AssetId | ''; label: string }> = [
  { asset: '', label: 'router.anyDestination' },
  { asset: USDC, label: 'USDC' },
  { asset: TESOURO, label: 'TESOURO' },
  { asset: BRL, label: 'BRL' },
  { asset: MXN, label: 'MXN' },
  { asset: USD, label: 'USD' },
];

const REFRESH_MS = 15_000;

interface RouteResponse {
  quotes: PublicRankedQuote[];
  anchors: AnchorResult[];
  elapsedMs: number;
  hasLiveQuote: boolean;
}

export default function RouterPage() {
  const { t } = useI18n();

  const [sellAsset, setSellAsset] = useState<AssetId>(USDC);
  const [buyAsset, setBuyAsset] = useState<AssetId | ''>('');
  const [country, setCountry] = useState<CountryCode | ''>('');
  const [amount, setAmount] = useState('100');

  const [result, setResult] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const presets = useMemo(
    () => SELLABLE.find((s) => s.asset === sellAsset)?.presets ?? ['100'],
    [sellAsset],
  );

  const query = useMemo(() => {
    const params = new URLSearchParams({ sell: sellAsset, amount });
    if (buyAsset) params.set('buy', buyAsset);
    if (country) params.set('country', country);
    return params.toString();
  }, [sellAsset, buyAsset, country, amount]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotes?${query}`);
      const payload = (await response.json()) as RouteResponse | { error: { message: string } };
      if ('error' in payload) throw new Error(payload.error.message);
      setResult(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query]);

  // Quotes go stale in seconds. Refreshing on a timer is what makes the table
  // "live quotes" rather than a snapshot someone took once.
  useEffect(() => {
    if (!autoRefresh || !result) return;
    const id = setInterval(() => void run(), REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, result, run]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('router.title')}</h1>
        <p className="mt-2 max-w-2xl text-ink-400">{t('router.subtitle')}</p>
      </header>

      <div className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-sm text-ink-300">{t('router.sellLabel')}</span>
          <select
            value={sellAsset}
            onChange={(e) => setSellAsset(e.target.value as AssetId)}
            className="field mt-2"
          >
            {SELLABLE.map((s) => (
              <option key={s.asset} value={s.asset}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <div className="sm:col-span-1">
          <AmountField
            label={t('common.amount')}
            value={amount}
            onChange={setAmount}
            presets={presets}
          />
        </div>

        <label className="block">
          <span className="text-sm text-ink-300">{t('router.countryLabel')}</span>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value as CountryCode | '')}
            className="field mt-2"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code ? c.label : t(c.label)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm text-ink-300">{t('router.destinationLabel')}</span>
          <select
            value={buyAsset}
            onChange={(e) => setBuyAsset(e.target.value as AssetId | '')}
            className="field mt-2"
          >
            {DESTINATIONS.map((d) => (
              <option key={d.asset || 'any'} value={d.asset}>
                {d.asset ? d.label : t(d.label)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading || !amount}
            className="btn btn-primary"
          >
            {loading ? t('common.loading') : t('router.compare')}
          </button>

          <label className="flex items-center gap-2 text-sm text-ink-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-brand-500"
            />
            {t('router.autoRefresh')}
          </label>
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {result ? (
        <>
          <QuoteTable
            quotes={result.quotes}
            anchors={result.anchors}
            elapsedMs={result.elapsedMs}
          />

          {/* The point of the page, stated plainly: it is one call. */}
          <div className="card p-4">
            <p className="text-xs text-ink-500">{t('router.apiHint')}</p>
            <code className="mt-1.5 block overflow-x-auto whitespace-nowrap font-mono text-xs text-brand-300">
              GET /api/quotes?{query}
            </code>
          </div>
        </>
      ) : null}

      <SepAuthPanel />
    </div>
  );
}
