'use client';

import { useState } from 'react';
import { Alert, AmountField, QuoteCard, displayAmount } from '@brk/ramp-ui';
import { BRL, TESOURO, assetCode } from '@brk/ramp-core';
import { FundGate } from '@/components/wallet/FundGate';
import { OrderCard } from '@/features/ramp/OrderCard';
import { PageIntro } from '@/components/layout/PageIntro';
import { PageShell } from '@/components/layout/PageShell';
import { ArrowRight, Check, ICON_WEIGHT, Spinner } from '@/components/icons';
import { ReturnTxPanel } from '@/features/offramp/ReturnTxPanel';
import { NetworkBanner } from '@/components/wallet/WalletButton';
import { useI18n } from '@/client/i18n';
import { useRampFlow } from '@/client/useRampFlow';
import { useWallet } from '@/client/wallet';

const ANCHOR_ID = 'etherfuse';

/**
 * The return leg — the half of the bounty's headline criterion that most demos
 * skip. Same lifecycle as the on-ramp, but the user's action in the middle is a
 * signature instead of a bank transfer.
 */
export function OffRampPage() {
  const { t, tag } = useI18n();
  const { address, status: walletStatus, balanceOf, refreshBalances } = useWallet();
  const [amount, setAmount] = useState('100');

  const flow = useRampFlow({
    anchorId: ANCHOR_ID,
    sellAsset: TESOURO,
    buyAsset: BRL,
    country: 'BR',
  });

  const connected = walletStatus === 'connected' && Boolean(address);
  const { quote, order, stage, busy, error } = flow;
  const held = balanceOf(TESOURO);
  const settled = order?.status === 'completed';

  return (
    <PageShell
      width="narrow"
      className="space-y-7"
      intro={
        <PageIntro
          step={4}
          title={t('offramp.title')}
          subtitle={t('offramp.subtitle')}
          plate="cristo-b"
          route={{
            from: assetCode(TESOURO),
            to: assetCode(BRL),
            rail: 'PIX',
            anchor: 'Etherfuse',
          }}
        />
      }
    >
      <NetworkBanner />
      <FundGate />

      {!connected ? <Alert tone="info">{t('common.connectFirst')}</Alert> : null}

      {error ? (
        <Alert
          tone="error"
          action={
            <button type="button" onClick={flow.clearError} className="btn btn-outline btn-sm">
              {t('common.cancel')}
            </button>
          }
        >
          {error.message}
        </Alert>
      ) : null}

      {stage === 'input' ? (
        <div className="card animate-rise space-y-5 p-6">
          <AmountField
            label={t('offramp.amountLabel')}
            value={amount}
            onChange={setAmount}
            presets={['10', '50', '100', held !== '0' ? held : '250']}
          />

          <p className="flex items-baseline justify-between gap-2 border-t border-line pt-4 text-xs text-fg-subtle">
            <span>{t('offramp.youHold')}</span>
            <span className="font-mono tabular-nums text-fg-muted">
              {held} {assetCode(TESOURO)}
            </span>
          </p>

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
                {t('offramp.getQuote')}
                <ArrowRight size={16} weight={ICON_WEIGHT} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      ) : null}

      {stage === 'quoted' && quote ? (
        <QuoteCard
          quote={quote}
          confirmLabel={t('offramp.createOrder')}
          confirming={busy === 'ordering'}
          onConfirm={() => void flow.confirm(address)}
          onRequote={flow.reset}
        />
      ) : null}

      {order ? (
        <div className="space-y-6">
          <OrderCard order={order} />

          {order.status === 'awaiting_signature' ? (
            <ReturnTxPanel
              order={order}
              onSigned={async () => {
                // The sandbox does not watch the chain — tell it the leg landed.
                await flow.simulate('crypto');
              }}
              onRegenerate={() => void flow.refresh()}
            />
          ) : null}

          {/*
            The sandbox's terminal state for an off-ramp is "funded": the burn
            is on-chain and reconciled, but no real reais exist to pay out, so
            the order rests here forever. That makes this the DEMO's finish
            line — offer the exit, or the pulsing step 3 reads as stuck.
          */}
          {order.status === 'processing' && order.mode === 'live' ? (
            <section className="card-featured animate-pop flex flex-wrap items-center gap-x-6 gap-y-4 p-6">
              <div className="min-w-0 flex-1">
                <p className="label flex items-center gap-2 text-verde">
                  <Check size={13} weight={ICON_WEIGHT} aria-hidden="true" />
                  {t('offramp.roundTripDone')}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                  {t('offramp.sandboxFunded')}
                </p>
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

          {settled ? (
            <section className="card-featured animate-pop flex flex-wrap items-center gap-x-6 gap-y-4 p-6">
              <div className="min-w-0 flex-1">
                <p className="label flex items-center gap-2 text-verde">
                  <Check size={13} weight={ICON_WEIGHT} aria-hidden="true" />
                  {t('offramp.done')}
                </p>
                <p className="figure mt-2.5 text-3xl">
                  {displayAmount(order.buyAmount, order.buyAsset, tag)}
                </p>
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
