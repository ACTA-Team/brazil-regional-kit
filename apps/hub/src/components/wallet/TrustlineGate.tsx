'use client';

import { useState } from 'react';
import { Alert } from '@brk/ramp-ui';
import { assetCode, type AssetId } from '@brk/ramp-core';
import { buildTrustlineTx } from '@brk/stablecoin-kit';
import { submitSignedTx } from '@/client/api';
import { ErrorAlert } from '@/components/feedback/ErrorAlert';
import { useI18n } from '@/client/i18n';
import { useWallet } from '@/client/wallet';

/**
 * A Stellar account cannot receive an asset it has no trustline for — the
 * anchor's payment simply fails. Some anchors hand back a claim transaction for
 * this; many do not, so the kit builds one itself and the check runs against the
 * live network even when the anchor is mocked.
 */
export function TrustlineGate({ asset, onReady }: { asset: AssetId; onReady?: () => void }) {
  const { t } = useI18n();
  const { address, hasTrustline, sign, refreshBalances, unfunded } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!address || unfunded || hasTrustline(asset)) return null;

  const establish = async () => {
    setBusy(true);
    setError(null);
    try {
      const xdr = await buildTrustlineTx(address, asset);
      const signed = await sign(xdr);
      await submitSignedTx(signed);
      await refreshBalances();
      onReady?.();
    } catch (e) {
      // Kept whole so the mapper can tell a wallet rejection from a chain
      // failure — on this control they are the two likely outcomes.
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Alert
        tone="warning"
        title={t('onramp.trustlineNeeded')}
        action={
          <button
            type="button"
            onClick={() => void establish()}
            disabled={busy}
            className="btn btn-primary btn-sm"
          >
            {busy ? t('common.signing') : t('onramp.trustlineSign')}
          </button>
        }
      >
        {t('onramp.trustlineWhy', { code: assetCode(asset) })}
      </Alert>

      {/* The prompt stays put when signing fails: the trustline is still
          missing, so hiding the call to action would strand the user. */}
      {error ? <ErrorAlert error={error} /> : null}
    </div>
  );
}
