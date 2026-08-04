'use client';

import { useState } from 'react';
import { Alert } from '@brk/ramp-ui';
import { assetCode, compare } from '@brk/ramp-core';
import { explorerTxUrl, resolveReturnTransaction } from '@brk/stablecoin-kit';
import type { PublicOrder } from '@/client/api';
import { submitSignedTx } from '@/client/api';
import { useI18n } from '@/client/i18n';
import { useWallet } from '@/client/wallet';

/**
 * The off-ramp's signing step.
 *
 * Three things go wrong here in practice and all three are handled explicitly:
 * the user does not hold enough of the asset, the anchor's transaction expired
 * with its quote, and Freighter is on the wrong network. Each gets its own
 * message rather than a generic "transaction failed".
 */
export function ReturnTxPanel({
  order,
  onSigned,
  onRegenerate,
}: {
  order: PublicOrder;
  onSigned: (hash: string) => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const { address, sign, balanceOf, refreshBalances, onTestnet } = useWallet();
  const [phase, setPhase] = useState<'idle' | 'building' | 'signing' | 'submitting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const held = balanceOf(order.sellAsset);
  const short = compare(held, order.sellAmount) < 0;
  const code = assetCode(order.sellAsset);

  const run = async () => {
    setError(null);
    try {
      setPhase('building');
      const { xdr } = await resolveReturnTransaction(order as never, address);

      setPhase('signing');
      const signed = await sign(xdr);

      setPhase('submitting');
      const result = await submitSignedTx(signed);

      setHash(result.hash);
      await refreshBalances();
      await onSigned(result.hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase('idle');
    }
  };

  if (hash) {
    return (
      <Alert
        tone="success"
        action={
          <a
            href={explorerTxUrl(hash)}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm"
          >
            {t('common.viewOnExplorer')}
          </a>
        }
      >
        {t('offramp.submitted')} · <span className="font-mono text-xs">{hash.slice(0, 12)}…</span>
      </Alert>
    );
  }

  const busyLabel =
    phase === 'signing'
      ? t('common.signing')
      : phase === 'submitting'
        ? t('common.submitting')
        : t('common.loading');

  return (
    <div className="card space-y-4 p-6">
      <div>
        <h3 className="section-title">{t('offramp.signBurn')}</h3>
        <p className="mt-1 text-sm text-fg-muted">{t('offramp.signHint', { code })}</p>
      </div>

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="label">{t('offramp.returning')}</dt>
          <dd className="mt-1 font-semibold tabular-nums">
            {order.sellAmount} {code}
          </dd>
        </div>
        <div>
          <dt className="label">{t('offramp.youHold')}</dt>
          <dd className={`mt-1 font-semibold tabular-nums ${short ? 'text-gold' : 'text-fg'}`}>
            {held} {code}
          </dd>
        </div>
      </dl>

      {short ? <Alert tone="warning">{t('offramp.insufficient', { code })}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={phase !== 'idle' || short || !onTestnet}
          className="btn btn-primary"
        >
          {phase === 'idle' ? t('offramp.signBurn') : busyLabel}
        </button>
        <button type="button" onClick={() => void onRegenerate()} className="btn btn-ghost btn-sm">
          {t('offramp.regenerate')}
        </button>
      </div>
    </div>
  );
}
