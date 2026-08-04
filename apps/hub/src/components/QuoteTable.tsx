'use client';

import { assetCode, isFiat, parseAsset } from '@brk/ramp-core';
import type { AnchorResult, RankedQuote } from '@brk/ramp-router';
import { formatMoney, formatToken, useI18n } from '@/lib/i18n';
import { ModeBadge } from './ModeBadge';

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
    <tr className="border-b border-border-subtle/60 last:border-0">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{q.anchorName}</span>
          <ModeBadge mode={q.mode} />
        </div>
      </td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-300">
        {amountLabel(q.buyAmount, q.buyAsset, tag)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-ink-300">
        {Number(q.price).toFixed(6)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-ink-400">
        {q.fee.amount} {assetCode(q.fee.asset)}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {contested && q.best ? (
            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              {t('router.best')}
            </span>
          ) : null}
          {contested && !q.best ? (
            <span className="rounded-full bg-surface-inset px-2 py-0.5 text-[10px] font-medium text-ink-400">
              −{q.worseByPct}%
            </span>
          ) : null}
          <span className="text-[10px] uppercase tracking-wide text-ink-500">
            {t(`router.firmness.${q.firmness}`)}
          </span>
        </div>
      </td>
    </tr>
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
    return <div className="card p-6 text-center text-sm text-ink-400">{t('router.noQuotes')}</div>;
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
          <header className="flex flex-wrap items-baseline gap-2 border-b border-border-subtle bg-surface-inset/60 px-4 py-2.5">
            <span className="text-sm font-semibold text-brand-300">
              {t('router.receiveGroup', { asset: assetCode(buyAsset) })}
            </span>
            <span className="text-xs text-ink-500">
              {group.length > 1
                ? t('router.groupContest', { count: group.length })
                : t('router.groupSingle')}
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-ink-500">
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
          <summary className="cursor-pointer text-ink-400">
            {t('router.skippedSummary', { count: skipped.length })}
          </summary>
          <ul className="mt-3 space-y-2">
            {skipped.map((a, i) => (
              <li key={`${a.anchorId}-${i}`} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-ink-300">{a.anchorName}</span>
                <span className="rounded bg-surface-inset px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-500">
                  {t(`router.outcome.${a.outcome}`)}
                </span>
                {a.reason ? (
                  <span className="min-w-0 flex-1 text-xs text-ink-500">{a.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="text-xs text-ink-500">
        {t('router.timing', { count: anchors.length, ms: elapsedMs })}
      </p>
    </div>
  );
}
