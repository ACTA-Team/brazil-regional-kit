'use client';

import { assetCode, isFiat, parseAsset } from '@brk/ramp-core';
import type { PublicQuote } from '@/lib/api';
import { formatMoney, formatToken, useI18n } from '@/lib/i18n';
import { ExpiryPill, useCountdown } from './Countdown';
import { ModeBadge } from './ModeBadge';

/** Fiat gets a currency symbol; tokens get a plain number and a ticker. */
export function displayAmount(amount: string, asset: string, tag: string): string {
  const { code } = parseAsset(asset);
  return isFiat(asset) ? formatMoney(amount, code, tag) : formatToken(amount, code, tag);
}

export function QuoteCard({
  quote,
  onConfirm,
  onRequote,
  confirming,
  confirmLabel,
  disabled,
}: {
  quote: PublicQuote;
  onConfirm: () => void;
  onRequote: () => void;
  confirming?: boolean;
  confirmLabel: string;
  disabled?: boolean;
}) {
  const { t, tag } = useI18n();
  const secondsLeft = useCountdown(quote.expiresAt);
  const expired = secondsLeft <= 0;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{quote.anchorName}</span>
          <ModeBadge mode={quote.mode} />
        </div>
        <ExpiryPill expiresAt={quote.expiresAt} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">{t('common.youSend')}</dt>
          <dd className="mt-1 font-semibold tabular-nums">
            {displayAmount(quote.sellAmount, quote.sellAsset, tag)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">{t('common.youReceive')}</dt>
          <dd className="mt-1 font-semibold tabular-nums text-brand-300">
            {displayAmount(quote.buyAmount, quote.buyAsset, tag)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">{t('common.rate')}</dt>
          <dd className="mt-1 font-mono text-sm tabular-nums text-ink-300">
            {Number(quote.price).toFixed(6)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">{t('common.fee')}</dt>
          <dd className="mt-1 font-mono text-sm tabular-nums text-ink-300">
            {quote.fee.amount} {assetCode(quote.fee.asset)}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        {expired ? (
          <button type="button" onClick={onRequote} className="btn btn-primary">
            {t('common.retry')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming || disabled}
            className="btn btn-primary"
          >
            {confirming ? t('common.loading') : confirmLabel}
          </button>
        )}
        <button type="button" onClick={onRequote} className="btn btn-ghost">
          {t('common.back')}
        </button>
      </div>
    </div>
  );
}
