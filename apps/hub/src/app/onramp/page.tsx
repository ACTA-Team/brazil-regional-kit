'use client';

import { useEffect, useRef, useState } from 'react';
import { BRL, TESOURO, assetCode } from '@brk/ramp-core';
import { Alert } from '@/components/Alert';
import { AmountField } from '@/components/AmountField';
import { FundGate } from '@/components/FundGate';
import { OrderCard } from '@/components/OrderCard';
import { PageIntro } from '@/components/PageIntro';
import { DepositPanel } from '@/components/DepositPanel';
import { QuoteCard, displayAmount } from '@/components/QuoteCard';
import { ArrowRight, Check, ICON_WEIGHT, Spinner } from '@/components/icons';
import { TrustlineGate } from '@/components/TrustlineGate';
import { NetworkBanner } from '@/components/WalletButton';
import { useI18n } from '@/lib/i18n';
import { useRampFlow } from '@/lib/useRampFlow';
import { useWallet } from '@/lib/wallet';

const ANCHOR_ID = 'etherfuse';

/**
 * Etherfuse refuses a second pending order for the same bank account and
 * amount, and offers no way to cancel the first. The only escape is a different
 * amount, so this is worth detecting specifically rather than showing the raw
 * anchor message and leaving the user stuck on a dead end.
 */
function isDuplicateOrder(error: { code?: string; message?: string }): boolean {
  return error.code === 'INVALID_ORDER_STATE' && /already exists/i.test(error.message ?? '');
}

/** Nudge by a non-round amount so the retry cannot collide again. */
function bumpAmount(current: string): string {
  const value = Number(current);
  return Number.isFinite(value) && value > 0 ? (value + 1 + Math.random()).toFixed(2) : '137.50';
}

export default function OnRampPage() {
  const { t, tag } = useI18n();
  const { address, status: walletStatus, refreshBalances } = useWallet();
  const [amount, setAmount] = useState('500');

  /**
   * Live-demo mode: fire the sandbox's fiat_received hook the moment the order
   * exists, instead of waiting for someone to press the button. On for a
   * reason — in front of an audience every manual click is a place to fumble,
   * and the PIX being simulated is already stated on screen. Turn it off to
   * walk the payment step deliberately.
   */
  const [autoSettle, setAutoSettle] = useState(true);
  const autoSettledOrder = useRef<string | null>(null);

  const flow = useRampFlow({
    anchorId: ANCHOR_ID,
    sellAsset: BRL,
    buyAsset: TESOURO,
    country: 'BR',
    // Settlement takes ~25s anchor-side; a snappier poll keeps the stepper
    // honest about progress instead of jumping two steps at once.
    pollMs: 1500,
  });

  const connected = walletStatus === 'connected' && Boolean(address);
  const { quote, order, stage, busy, error } = flow;

  useEffect(() => {
    if (!autoSettle || !order) return;
    if (order.status !== 'awaiting_payment') return;
    // Once per order — a failed simulation must not loop.
    if (autoSettledOrder.current === order.id) return;

    autoSettledOrder.current = order.id;
    void flow.simulate('fiat');
  }, [autoSettle, order, flow]);

  // The asset only lands once the anchor settles — refresh balances then.
  const settled = order?.status === 'completed';

  return (
    <div className="mx-auto max-w-2xl space-y-7">
      <PageIntro
        step={1}
        title={t('onramp.title')}
        subtitle={t('onramp.subtitle')}
        route={{
          from: assetCode(BRL),
          to: assetCode(TESOURO),
          rail: 'PIX',
          anchor: 'Etherfuse',
        }}
      />

      <NetworkBanner />
      <FundGate />

      {!connected ? <Alert tone="info">{t('common.connectFirst')}</Alert> : null}

      {error ? (
        <Alert
          tone="error"
          action={
            <button
              type="button"
              onClick={() => {
                flow.clearError();
                // A duplicate-order rejection is keyed on the amount, and the
                // anchor has no cancel endpoint — so nudging the amount is the
                // only thing that actually clears it. Do it for the user rather
                // than leaving them to guess.
                if (isDuplicateOrder(error)) {
                  setAmount((current) => bumpAmount(current));
                  flow.reset();
                }
              }}
              className="btn btn-outline btn-sm"
            >
              {isDuplicateOrder(error) ? t('onramp.tryAnotherAmount') : t('common.cancel')}
            </button>
          }
        >
          {error.message}
          {isDuplicateOrder(error) ? (
            <span className="mt-1 block text-xs opacity-80">{t('onramp.duplicateHint')}</span>
          ) : null}
        </Alert>
      ) : null}

      {stage === 'input' ? (
        <div className="card animate-rise space-y-5 p-6">
          <AmountField
            label={t('onramp.amountLabel')}
            value={amount}
            onChange={setAmount}
            currency="BRL"
            suffix="R$"
          />

          <button
            type="button"
            className="btn btn-primary btn-lg w-full"
            disabled={!connected || busy === 'quoting' || !amount}
            onClick={() => void flow.getQuote(amount, address)}
          >
            {busy === 'quoting' ? (
              <>
                <Spinner />
                {t('common.loading')}
              </>
            ) : (
              <>
                {t('onramp.getQuote')}
                <ArrowRight size={16} weight={ICON_WEIGHT} aria-hidden="true" />
              </>
            )}
          </button>

          <label className="flex cursor-pointer items-start gap-2.5 border-t border-line pt-4 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={autoSettle}
              onChange={(e) => setAutoSettle(e.target.checked)}
              className="mt-0.5 accent-gold"
            />
            <span>
              {t('onramp.autoSettle')}
              <span className="mt-0.5 block text-xs text-fg-subtle">
                {t('onramp.autoSettleHint')}
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {stage === 'quoted' && quote ? (
        <>
          <TrustlineGate asset={TESOURO} />
          <QuoteCard
            quote={quote}
            confirmLabel={t('onramp.createOrder')}
            confirming={busy === 'ordering'}
            onConfirm={() => void flow.confirm(address)}
            onRequote={flow.reset}
          />
        </>
      ) : null}

      {/*
        The anchor blocked the exact amount, so the flow retried a few centavos
        up. Saying so is not optional — a total the user did not type needs an
        explanation, however small the difference.
      */}
      {flow.adjustedAmount ? (
        <Alert tone="warning">{t('onramp.amountAdjusted', { amount: flow.adjustedAmount })}</Alert>
      ) : null}

      {order ? (
        <div className="space-y-6">
          <OrderCard order={order} />

          {order.paymentInstructions && order.status === 'awaiting_payment' ? (
            <DepositPanel
              instructions={order.paymentInstructions}
              simulating={busy === 'simulating'}
              onSimulate={() => void flow.simulate('fiat')}
            />
          ) : null}

          {/* The payoff, on the featured card the manual reserves for success. */}
          {settled ? (
            <section className="card-featured animate-pop flex flex-wrap items-center gap-x-6 gap-y-4 p-6">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-success">
                  <Check size={13} weight={ICON_WEIGHT} aria-hidden="true" />
                  {t('onramp.done')}
                </p>
                <p className="mt-2 text-3xl font-extrabold tabular-nums">
                  {displayAmount(order.buyAmount, order.buyAsset, tag)}
                </p>
                <p className="mt-1 text-sm text-fg-muted">{t('onramp.inYourWallet')}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void refreshBalances();
                  flow.reset();
                }}
                className="btn btn-outline"
              >
                {t('common.startOver')}
              </button>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
