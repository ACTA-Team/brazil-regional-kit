'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AmountField } from '@brk/ramp-ui';
import {
  BRL,
  MXN,
  TESOURO,
  USDC,
  type AssetId,
  type CountryCode,
  type RampErrorCode,
} from '@brk/ramp-core';
import type { AnchorResult } from '@brk/ramp-router';
import { ErrorAlert } from '@/components/feedback/ErrorAlert';
import { PageIntro } from '@/components/layout/PageIntro';
import { PageShell } from '@/components/layout/PageShell';
import {
  ArrowUUpLeft,
  CaretRight,
  Coins,
  ICON_WEIGHT,
  Money,
  Wallet,
  type Icon,
} from '@/components/icons';
import { ApiError } from '@/client/api';
import { recallDid } from '@/client/identity';
import { QuoteTable, type PublicRankedQuote } from '@/features/router/QuoteTable';
import { SepAuthPanel } from '@/features/sep/SepAuthPanel';
import { useI18n } from '@/client/i18n';

/**
 * One-click scenarios instead of a corridor construction kit.
 *
 * The first version of this page offered four free-form selects — sell asset,
 * amount, country, destination. That let a user assemble USDC → TESOURO, a pair
 * no anchor can serve because it is a DEX swap rather than a ramp, and answered
 * them with an empty table. A form that lets you ask questions with no possible
 * answer is not flexibility, it is a trap.
 *
 * Each scenario below is a question a real person actually has, phrased as one
 * button, and every one of them is guaranteed to produce quotes.
 */
interface Scenario {
  id: string;
  Glyph: Icon;
  titleKey: string;
  hintKey: string;
  sellAsset: AssetId;
  buyAsset?: AssetId;
  country?: CountryCode;
  defaultAmount: string;
  presets: string[];
}

const SCENARIOS: Scenario[] = [
  {
    id: 'brl',
    Glyph: Money,
    titleKey: 'router.scenario.brl',
    hintKey: 'router.scenario.brlHint',
    sellAsset: BRL,
    country: 'BR',
    defaultAmount: '500',
    presets: ['100', '250', '500', '1000'],
  },
  {
    id: 'mxn',
    Glyph: Coins,
    titleKey: 'router.scenario.mxn',
    hintKey: 'router.scenario.mxnHint',
    sellAsset: MXN,
    country: 'MX',
    defaultAmount: '400',
    // The Etherfuse sandbox caps MXN on-ramps at 500.
    presets: ['100', '250', '400', '500'],
  },
  {
    id: 'usdc',
    Glyph: Wallet,
    titleKey: 'router.scenario.usdc',
    hintKey: 'router.scenario.usdcHint',
    sellAsset: USDC,
    defaultAmount: '100',
    presets: ['25', '50', '100', '500'],
  },
  {
    id: 'tesouro',
    Glyph: ArrowUUpLeft,
    titleKey: 'router.scenario.tesouro',
    hintKey: 'router.scenario.tesouroHint',
    sellAsset: TESOURO,
    buyAsset: BRL,
    country: 'BR',
    defaultAmount: '100',
    presets: ['50', '100', '250', '500'],
  },
];

const REFRESH_MS = 15_000;

/** The error envelope every API route in this app returns. */
interface ApiErrorBody {
  code: RampErrorCode;
  message: string;
  anchorId?: string;
  retryable?: boolean;
}

interface RouteResponse {
  quotes: PublicRankedQuote[];
  anchors: AnchorResult[];
  elapsedMs: number;
  hasLiveQuote: boolean;
}

export function RouterPage() {
  const { t } = useI18n();

  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]!);
  const [amount, setAmount] = useState(SCENARIOS[0]!.defaultAmount);
  const [result, setResult] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  // Kept whole, not flattened to a message: the friendly-error mapper
  // sorts on the `code` that `e.message` would discard.
  const [error, setError] = useState<unknown>(null);

  /*
   * The DID is read once, on mount, rather than on every render.
   *
   * It only ever changes on the identity page, which is a navigation away — and
   * reading localStorage during render would make the first server-rendered
   * pass disagree with the first client one.
   */
  const [did, setDid] = useState<string | null>(null);
  useEffect(() => {
    // Deferred a tick so the read's setState never lands synchronously inside
    // the effect body — same shape as the initial fetch below.
    const id = setTimeout(() => setDid(recallDid()), 0);
    return () => clearTimeout(id);
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ sell: scenario.sellAsset, amount });
    if (scenario.buyAsset) params.set('buy', scenario.buyAsset);
    if (scenario.country) params.set('country', scenario.country);
    // Optional in the strict sense: without it the response is byte-for-byte
    // what it was before identity existed.
    if (did) params.set('did', did);
    return params.toString();
  }, [scenario, amount, did]);

  const run = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotes?${q}`);
      const payload = (await response.json()) as RouteResponse | { error: ApiErrorBody };
      // Rebuild the error so its code survives the HTTP hop — a bare
      // `new Error(message)` would strip exactly what the mapper reads.
      if ('error' in payload) throw new ApiError(payload.error);
      setResult(payload);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Picking a scenario IS the question — fetch immediately, no second click. */
  const pick = useCallback(
    (next: Scenario) => {
      setScenario(next);
      setAmount(next.defaultAmount);
      const params = new URLSearchParams({ sell: next.sellAsset, amount: next.defaultAmount });
      if (next.buyAsset) params.set('buy', next.buyAsset);
      if (next.country) params.set('country', next.country);
      if (did) params.set('did', did);
      void run(params.toString());
    },
    [run, did],
  );

  // First render answers the default scenario rather than showing a blank
  // page. Deferred a tick so the fetch's setState never lands synchronously
  // inside the effect body.
  useEffect(() => {
    const id = setTimeout(() => void run(query), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quotes go stale in seconds. Refreshing on a timer is what makes the table
  // "live quotes" rather than a snapshot someone took once.
  useEffect(() => {
    if (!autoRefresh || !result) return;
    const id = setInterval(() => void run(query), REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, result, run, query]);

  return (
    <PageShell
      className="space-y-6"
      intro={
        <PageIntro title={t('router.title')} subtitle={t('router.subtitle')} plate="cristo-dense" />
      }
    >
      {/* ── Step 1: which situation are you in? ─────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SCENARIOS.map((s) => {
          const active = s.id === scenario.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => pick(s)}
              aria-pressed={active}
              className={`card card-glow card-hover flex flex-col gap-2 p-6 text-left ${
                active ? 'border-gold/50' : ''
              }`}
            >
              <span className="relative flex items-center gap-2.5 font-semibold">
                <s.Glyph
                  size={17}
                  weight={ICON_WEIGHT}
                  aria-hidden="true"
                  className={active ? 'text-gold' : 'text-verde'}
                />
                {t(s.titleKey)}
              </span>
              <span className="relative text-xs leading-relaxed text-fg-muted">{t(s.hintKey)}</span>
            </button>
          );
        })}
      </div>

      {/* ── Step 2: how much? ───────────────────────────────────────────── */}
      <div className="card flex flex-wrap items-end gap-4 p-6">
        <div className="min-w-56 flex-1">
          <AmountField
            label={t('router.amountFor', { asset: scenario.sellAsset.split(':')[1] ?? '' })}
            value={amount}
            onChange={setAmount}
            presets={scenario.presets}
          />
        </div>
        <button
          type="button"
          onClick={() => void run(query)}
          disabled={loading || !amount}
          className="btn btn-primary"
        >
          {loading ? t('common.loading') : t('router.compare')}
        </button>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="accent-gold"
          />
          {t('router.autoRefresh')}
        </label>
      </div>

      {error ? (
        <ErrorAlert
          error={error}
          action={
            <button
              type="button"
              onClick={() => void run(query)}
              className="btn btn-outline btn-sm"
            >
              {t('error.retry')}
            </button>
          }
        />
      ) : null}

      {result ? (
        <>
          <QuoteTable
            quotes={result.quotes}
            anchors={result.anchors}
            elapsedMs={result.elapsedMs}
          />

          {/*
            The page's whole argument, in a sentence anyone can read.

            This used to be a bare percent-encoded URL, which is the one thing
            on the page that means nothing to the person the demo is for:
            `sell=stellar%3AUSDC%3AGBBD47IF…` is noise unless you already know
            what it says. The claim is what matters, so the claim is what shows;
            the request that backs it is one click away, decoded, for anyone who
            wants to check.
          */}
          <div className="card p-6">
            <p className="text-sm leading-relaxed">
              {t('router.oneCall', { count: result.anchors.length })}
            </p>

            <details className="group mt-3">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-fg-subtle transition-colors hover:text-fg">
                <CaretRight
                  size={11}
                  weight={ICON_WEIGHT}
                  aria-hidden="true"
                  className="transition-transform group-open:rotate-90"
                />
                {t('router.showRequest')}
              </summary>
              <code className="well mt-2 block break-all p-3 text-xs leading-relaxed text-success">
                GET /api/quotes?{decodeURIComponent(query)}
              </code>
            </details>
          </div>
        </>
      ) : null}

      <SepAuthPanel />
    </PageShell>
  );
}
