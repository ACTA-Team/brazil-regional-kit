'use client';

import { useState } from 'react';
import { Alert } from '@brk/ramp-ui';
import { assetCode, type AssetId } from '@brk/ramp-core';
import { buildTrustlineTx } from '@brk/stablecoin-kit';
import { submitSignedTx } from '@/client/api';
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
  const [error, setError] = useState<string | null>(null);

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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Alert
      tone="warning"
      action={
        <button
          type="button"
          onClick={() => void establish()}
          disabled={busy}
          className="btn btn-primary text-xs"
        >
          {busy ? t('common.signing') : t('onramp.trustlineSign')}
        </button>
      }
    >
      {error ?? `${t('onramp.trustlineNeeded')} (${assetCode(asset)})`}
    </Alert>
  );
}
