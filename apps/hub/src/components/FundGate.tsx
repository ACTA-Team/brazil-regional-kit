'use client';

import { useState } from 'react';
import { FRIENDBOT } from '@brk/ramp-core';
import { useI18n } from '@/lib/i18n';
import { useWallet } from '@/lib/wallet';
import { Alert } from './Alert';

/** A fresh Freighter account has no ledger entry until friendbot funds it. */
export function FundGate() {
  const { t } = useI18n();
  const { address, unfunded, refreshBalances } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!address || !unfunded) return null;

  const fund = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(address)}`);
      if (!res.ok && res.status !== 400) throw new Error(`Friendbot returned ${res.status}`);
      await refreshBalances();
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
          onClick={() => void fund()}
          disabled={busy}
          className="btn btn-primary text-xs"
        >
          {busy ? t('common.loading') : t('common.fund')}
        </button>
      }
    >
      {error ?? t('common.fundAccount')}
    </Alert>
  );
}
