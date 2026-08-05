'use client';

import { assetCode, isFiat, parseAsset } from '@brk/ramp-core';
import { ModeBadge } from '@brk/ramp-ui';
import type { AnchorResult, RankedQuote } from '@brk/ramp-router';
import { formatMoney, formatToken, useI18n } from '@/client/i18n';

export type PublicRankedQuote = Omit<RankedQuote, 'raw'>;

function amountLabel(amount: string, asset: string, tag: string): string {
  const { code } = parseAsset(asset);
  return isFiat(asset) ? formatMoney(amount, code, tag) : formatToken(amount, code, tag);
}

function QuoteRow({ quote: q }: { quote: PublicRankedQuote }) {
  const { t, tag } = useI18n();
  // A "best" badge is only meaningful when something else quoted the same
  // destination asset. Being the sole option is not a win.
  const contested = q.groupSize > 1;

  return (
    <tr className="border-b border-line/60 last:border-0">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{q.anchorName}</span>
          <ModeBadge mode={q.mode} />
        </div>
      </td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-gold">
        {amountLabel(q.buyAmount, q.buyAsset, tag)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-fg-muted">
        {Number(q.price).toFixed(6)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-fg-muted">
        {q.fee.amount} {assetCode(q.fee.asset)}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {contested && q.best ? (
            // The one filled chip in the app besides the logo. Black ink, not
            // white: the verde is a light oklch, and white on it fails contrast
            // where near-black passes comfortably.
            <span className="chip border-transparent bg-verde font-semibold text-black uppercase">
              {t('router.best')}
            </span>
          ) : null}
          {contested && !q.best ? (
            <span className="chip chip-neutral tabular-nums">−{q.worseByPct}%</span>
          ) : null}
          <span className="label text-[10px]">{t(`router.firmness.${q.firmness}`)}</span>
        </div>
      </td>
    </tr>
  );
}

function QuoteMobileCard({ quote: q }: { quote: PublicRankedQuote }) {
  const { t, tag } = useI18n();
  const contested = q.groupSize > 1;

  return (
    <article className="border-b border-line/60 px-4 py-4 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{q.anchorName}</h3>
            <ModeBadge mode={q.mode} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {contested && q.best ? (
              <span className="chip border-transparent bg-verde font-semibold text-black uppercase">
                {t('router.best')}
              </span>
            ) : null}
            {contested && !q.best ? (
              <span className="chip chip-neutral tabular-nums">-{q.worseByPct}%</span>
            ) : null}
            <span className="label text-[10px]">{t(`router.firmness.${q.firmness}`)}</span>
          </div>
        </div>
        <p className="shrink-0 text-right font-semibold tabular-nums text-gold">
          {amountLabel(q.buyAmount, q.buyAsset, tag)}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <div>
          <dt className="label">{t('common.rate')}</dt>
          <dd className="mt-1 font-mono tabular-nums text-fg-muted">
            {Number(q.price).toFixed(6)}
          </dd>
        </div>
        <div>
          <dt className="label">{t('common.fee')}</dt>
          <dd className="mt-1 font-mono tabular-nums text-fg-muted">
            {q.fee.amount} {assetCode(q.fee.asset)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

/**
 * The router's answer, grouped by what you would RECEIVE.
 *
 * An open-ended question — "what can I get for 500 BRL?" — legitimately spans
 * several destination assets. The first version rendered them as one flat list,
 * which invited a nonsense reading: "97 USDC" sitting above "431 TESOURO" with
 * a best-badge, as if dollars and bonds were competing on the same number. They
 * are different products; only anchors offering the SAME product compete.
 *
 * So: one section per destination asset, anchors ranked inside it, and the
 * best-badge only where there is a real contest.
 */
export function QuoteTable({
  quotes,
  anchors,
  elapsedMs,
}: {
  quotes: PublicRankedQuote[];
  anchors: AnchorResult[];
  elapsedMs: number;
}) {
  const { t } = useI18n();
  const skipped = anchors.filter((a) => a.outcome !== 'quoted');

  if (quotes.length === 0) {
    return <div className="card p-6 text-center text-sm text-fg-muted">{t('router.noQuotes')}</div>;
  }

  // Group by destination asset, preserving the router's ordering inside each.
  const groups = new Map<string, PublicRankedQuote[]>();
  for (const q of quotes) {
    const bucket = groups.get(q.buyAsset);
    if (bucket) bucket.push(q);
    else groups.set(q.buyAsset, [q]);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([buyAsset, group]) => (
        <section key={buyAsset} className="card overflow-hidden">
          <header className="flex flex-wrap items-baseline gap-2.5 border-b border-line bg-black/30 px-4 py-3">
            <span className="text-sm font-semibold tracking-[-0.01em] text-fg">
              {t('router.receiveGroup', { asset: assetCode(buyAsset) })}
            </span>
            <span className="text-xs text-fg-subtle">
              {group.length > 1
                ? t('router.groupContest', { count: group.length })
                : t('router.groupSingle')}
            </span>
          </header>
          <div className="sm:hidden">
            {group.map((q) => (
              <QuoteMobileCard key={`${q.anchorId}-${q.buyAsset}`} quote={q} />
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-2xl text-sm">
              <thead>
                <tr className="label border-b border-line text-left">
                  <th className="px-4 py-2.5 font-medium">{t('common.anchor')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('common.youReceive')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('common.rate')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('common.fee')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {group.map((q) => (
                  <QuoteRow key={`${q.anchorId}-${q.buyAsset}`} quote={q} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/*
        Anchors that produced nothing are shown, not hidden. A router that
        quietly drops anchors is impossible to trust and impossible to debug.
      */}
      {skipped.length ? (
        <details className="card px-4 py-3 text-sm">
          <summary className="cursor-pointer text-fg-muted">
            {t('router.skippedSummary', { count: skipped.length })}
          </summary>
          <ul className="mt-3 space-y-2">
            {skipped.map((a, i) => (
              <li key={`${a.anchorId}-${i}`} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-fg-muted">{a.anchorName}</span>
                <span className="chip chip-neutral uppercase">
                  {t(`router.outcome.${a.outcome}`)}
                </span>
                {a.reason ? (
                  <span className="min-w-0 flex-1 text-xs text-fg-subtle">{a.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="text-xs text-fg-subtle">
        {t('router.timing', { count: anchors.length, ms: elapsedMs })}
      </p>
    </div>
  );
}
