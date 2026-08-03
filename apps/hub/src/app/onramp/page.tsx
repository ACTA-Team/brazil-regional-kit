'use client';

import { useState } from 'react';
import { BRL, TESOURO, assetCode } from '@brk/ramp-core';
import { Alert } from '@/components/Alert';
import { AmountField } from '@/components/AmountField';
import { FundGate } from '@/components/FundGate';
import { ModeBadge } from '@/components/ModeBadge';
import { OrderStepper } from '@/components/OrderStepper';
import { PixPanel } from '@/components/PixPanel';
import { QuoteCard, displayAmount } from '@/components/QuoteCard';
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

  const flow = useRampFlow({
    anchorId: ANCHOR_ID,
    sellAsset: BRL,
    buyAsset: TESOURO,
    country: 'BR',
  });

  const connected = walletStatus === 'connected' && Boolean(address);
  const { quote, order, stage, busy, error } = flow;

  // The asset only lands once the anchor settles — refresh balances then.
  const settled = order?.status === 'completed';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{t('onramp.title')}</h1>
        </div>
        <p className="mt-2 text-ink-400">{t('onramp.subtitle')}</p>
        <p className="mt-2 font-mono text-xs text-ink-500">
          {assetCode(BRL)} → {assetCode(TESOURO)} · PIX · Etherfuse
        </p>
      </header>

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
              className="btn btn-ghost text-xs"
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
        <div className="card space-y-4 p-5">
          <AmountField
            label={t('onramp.amountLabel')}
            value={amount}
            onChange={setAmount}
            currency="BRL"
            suffix="R$"
          />
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={!connected || busy === 'quoting' || !amount}
            onClick={() => void flow.getQuote(amount, address)}
          >
            {busy === 'quoting' ? t('common.loading') : t('onramp.getQuote')}
          </button>
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

      {order ? (
        <div className="space-y-6">
          <div className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{order.anchorName}</span>
                <ModeBadge mode={order.mode} />
              </div>
              <span className="font-mono text-xs text-ink-500">{order.id.slice(0, 8)}</span>
            </div>
            <OrderStepper direction={order.direction} status={order.status} />
          </div>

          {order.paymentInstructions?.type === 'pix' && order.status === 'awaiting_payment' ? (
            <PixPanel
              instructions={order.paymentInstructions}
              simulating={busy === 'simulating'}
              onSimulate={() => void flow.simulate('fiat')}
            />
          ) : null}

          {settled ? (
            <Alert
              tone="success"
              action={
                <button
                  type="button"
                  onClick={() => {
                    void refreshBalances();
                    flow.reset();
                  }}
                  className="btn btn-ghost text-xs"
                >
                  {t('common.startOver')}
                </button>
              }
            >
              {t('onramp.done')} —{' '}
              <strong>{displayAmount(order.buyAmount, order.buyAsset, tag)}</strong>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
