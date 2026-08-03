'use client';

import { useState } from 'react';
import { BRL, TESOURO, assetCode } from '@brk/ramp-core';
import { Alert } from '@/components/Alert';
import { AmountField } from '@/components/AmountField';
import { FundGate } from '@/components/FundGate';
import { ModeBadge } from '@/components/ModeBadge';
import { OrderStepper } from '@/components/OrderStepper';
import { QuoteCard, displayAmount } from '@/components/QuoteCard';
import { ReturnTxPanel } from '@/components/ReturnTxPanel';
import { NetworkBanner } from '@/components/WalletButton';
import { useI18n } from '@/lib/i18n';
import { useRampFlow } from '@/lib/useRampFlow';
import { useWallet } from '@/lib/wallet';

const ANCHOR_ID = 'etherfuse';

/**
 * The return leg — the half of the bounty's headline criterion that most demos
 * skip. Same lifecycle as the on-ramp, but the user's action in the middle is a
 * signature instead of a bank transfer.
 */
export default function OffRampPage() {
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
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('offramp.title')}</h1>
        <p className="mt-2 text-ink-400">{t('offramp.subtitle')}</p>
        <p className="mt-2 font-mono text-xs text-ink-500">
          {assetCode(TESOURO)} → {assetCode(BRL)} · PIX · Etherfuse
        </p>
      </header>

      <NetworkBanner />
      <FundGate />

      {!connected ? <Alert tone="info">{t('common.connectFirst')}</Alert> : null}

      {error ? (
        <Alert
          tone="error"
          action={
            <button type="button" onClick={flow.clearError} className="btn btn-ghost text-xs">
              {t('common.cancel')}
            </button>
          }
        >
          {error.message}
        </Alert>
      ) : null}

      {stage === 'input' ? (
        <div className="card space-y-4 p-5">
          <AmountField
            label={t('offramp.amountLabel')}
            value={amount}
            onChange={setAmount}
            presets={['10', '50', '100', held !== '0' ? held : '250']}
          />
          <p className="text-xs text-ink-500">
            {t('offramp.youHold')}: <span className="font-mono">{held}</span> {assetCode(TESOURO)}
          </p>
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={!connected || busy === 'quoting' || !amount}
            onClick={() => void flow.getQuote(amount, address)}
          >
            {busy === 'quoting' ? t('common.loading') : t('offramp.getQuote')}
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
              {t('offramp.done')} —{' '}
              <strong>{displayAmount(order.buyAmount, order.buyAsset, tag)}</strong>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
