'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AmountField, DepositPanel, QuoteCard, displayAmount } from '@brk/ramp-ui';
import { BRL, TESOURO, assetCode } from '@brk/ramp-core';
import { ErrorAlert, isDuplicateOrder } from '@/components/feedback/ErrorAlert';
import { FundGate } from '@/components/wallet/FundGate';
import { OrderCard } from '@/features/ramp/OrderCard';
import { PageIntro } from '@/components/layout/PageIntro';
import { PageShell } from '@/components/layout/PageShell';
import { ArrowRight, Check, ICON_WEIGHT, Spinner } from '@/components/icons';
import { TrustlineGate } from '@/components/wallet/TrustlineGate';
import { ConnectWalletPrompt, NetworkBanner } from '@/components/wallet/WalletButton';
import { useI18n } from '@/client/i18n';
import { useRampFlow } from '@/client/useRampFlow';
import { useWallet } from '@/client/wallet';

const ANCHOR_ID = 'etherfuse';

/** Nudge by a non-round amount so the retry cannot collide again. */
function bumpAmount(current: string): string {
  const value = Number(current);
  return Number.isFinite(value) && value > 0 ? (value + 1 + Math.random()).toFixed(2) : '137.50';
}

export function OnRampPage() {
  const { t, tag } = useI18n();
  const { address, status: walletStatus, refreshBalances, hasTrustline } = useWallet();
  // The sandbox refuses more than 500, so the presets stay under it — a demo
  // whose default button is the one amount the anchor rejects is a trap.
  const [amount, setAmount] = useState('250');

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
    <PageShell
      width="narrow"
      className="space-y-7"
      intro={
        <PageIntro
          title={t('onramp.title')}
          subtitle={t('onramp.subtitle')}
          plate="pao-dense"
          route={{
            from: assetCode(BRL),
            to: assetCode(TESOURO),
            rail: 'PIX',
            anchor: 'Etherfuse',
          }}
        />
      }
    >
      <NetworkBanner />
      <FundGate />

      {!connected ? <ConnectWalletPrompt /> : null}

      {error ? (
        <ErrorAlert
          error={error}
          action={
            <button
              type="button"
              onClick={() => {
                flow.clearError();
                // Nudge the amount for them rather than leaving them to guess.
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
          {/* The anchor keys a duplicate rejection on the amount and offers no
              cancel endpoint, so the mapper's generic "start a new one" is
              wrong here — only a different amount clears it. */}
          {isDuplicateOrder(error) ? t('onramp.duplicateHint') : undefined}
        </ErrorAlert>
      ) : null}

      {stage === 'input' ? (
        <div className="card animate-rise space-y-5 p-6">
          <AmountField
            label={t('onramp.amountLabel')}
            value={amount}
            onChange={setAmount}
            currency="BRL"
            suffix="R$"
            presets={['50', '100', '250', '499']}
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
          {/*
            No trustline, no order.

            A Stellar account cannot hold an asset it has not trusted, so an
            anchor asked to deliver into one has nowhere to put the money. It
            does not fail loudly either: the order reaches `funded` — the anchor
            considers itself paid — and then stops there forever. Warning about
            the trustline while leaving the button live is how someone strands
            an order they can never finish.
          */}
          <QuoteCard
            quote={quote}
            confirmLabel={t('onramp.createOrder')}
            confirming={busy === 'ordering'}
            disabled={!hasTrustline(TESOURO)}
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
                <p className="label flex items-center gap-2 text-verde">
                  <Check size={13} weight={ICON_WEIGHT} aria-hidden="true" />
                  {t('onramp.done')}
                </p>
                <p className="figure mt-2.5 text-3xl">
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
    </PageShell>
  );
}
