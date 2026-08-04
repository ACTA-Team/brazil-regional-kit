'use client';

import { assetCode, isFiat, parseAsset, type Quote } from '@brk/ramp-core';
import { formatMoney, formatToken, useRampUI } from '../../i18n/provider';
import { ExpiryPill, useCountdown } from './Countdown';
import { ArrowRight, ICON_WEIGHT, Spinner } from '../../internal/icons';
import { ModeBadge } from './ModeBadge';

/**
 * A quote as it reaches a browser: everything the core type carries except the
 * anchor's untouched payload, which is server-side detail and occasionally
 * contains data an anchor would rather not have echoed back.
 */
export type PublicQuote = Omit<Quote, 'raw'>;

/** Fiat gets a currency symbol; tokens get a plain number and a ticker. */
export function displayAmount(amount: string, asset: string, locale: string): string {
  const { code } = parseAsset(asset);
  return isFiat(asset) ? formatMoney(amount, code, locale) : formatToken(amount, code, locale);
}

/**
 * The decision moment, so it gets the cutout card and the whole width.
 *
 * Everything a person actually decides on — what leaves, what arrives — is set
 * large and side by side. Rate and fee are true and present but demoted to
 * fine print, because nobody accepts or rejects a quote on the sixth decimal
 * of the rate; they accept it on the number that lands in their account.
 */
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
  const { t, locale } = useRampUI();
  const secondsLeft = useCountdown(quote.expiresAt);
  const expired = secondsLeft <= 0;

  return (
    <div className="card-cutout animate-pop overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-6 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{quote.anchorName}</span>
          <ModeBadge mode={quote.mode} />
        </div>
        <ExpiryPill expiresAt={quote.expiresAt} />
      </header>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-6 py-7 sm:gap-6">
        <div className="min-w-0">
          <p className="label">{t('common.youSend')}</p>
          <p className="figure mt-2 truncate text-[26px]">
            {displayAmount(quote.sellAmount, quote.sellAsset, locale)}
          </p>
        </div>

        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-black/40 text-verde"
        >
          <ArrowRight size={15} weight={ICON_WEIGHT} />
        </span>

        <div className="min-w-0 text-right">
          <p className="label">{t('common.youReceive')}</p>
          {/* The one number the decision turns on. */}
          <p className="figure mt-2 truncate text-[26px] text-gold">
            {displayAmount(quote.buyAmount, quote.buyAsset, locale)}
          </p>
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-6 py-3 text-xs">
        <div className="flex gap-1.5">
          <dt className="text-fg-subtle">{t('common.rate')}</dt>
          <dd className="font-mono tabular-nums text-fg-muted">{Number(quote.price).toFixed(6)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-fg-subtle">{t('common.fee')}</dt>
          <dd className="font-mono tabular-nums text-fg-muted">
            {quote.fee.amount} {assetCode(quote.fee.asset)}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2 border-t border-line px-6 py-4">
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
            {confirming ? (
              <>
                <Spinner />
                {t('common.loading')}
              </>
            ) : (
              confirmLabel
            )}
          </button>
        )}
        <button type="button" onClick={onRequote} className="btn btn-ghost">
          {t('common.back')}
        </button>
      </div>
    </div>
  );
}

export { Spinner };
