'use client';

import { useState } from 'react';
import { Alert } from '@brk/ramp-ui';
import { FRIENDBOT } from '@brk/ramp-core';
import { ErrorAlert } from '@/components/feedback/ErrorAlert';
import { useI18n } from '@/client/i18n';
import { useWallet } from '@/client/wallet';

/** A fresh Freighter account has no ledger entry until friendbot funds it. */
export function FundGate() {
  const { t } = useI18n();
  const { address, unfunded, refreshBalances } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!address || !unfunded) return null;

  const fund = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(address)}`);
      if (!res.ok && res.status !== 400) throw new Error(`Friendbot returned ${res.status}`);
      await refreshBalances();
    } catch (e) {
      // Kept whole: friendbot being unreachable and friendbot refusing are
      // different problems, and the mapper reads them apart.
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Alert
        tone="warning"
        title={t('common.fundAccount')}
        action={
          <button
            type="button"
            onClick={() => void fund()}
            disabled={busy}
            className="btn btn-primary btn-sm"
          >
            {busy ? t('common.loading') : t('common.fund')}
          </button>
        }
      >
        {t('common.fundWhy')}
      </Alert>

      {/* The prompt stays put when funding fails — the account is still
          unfunded, so the call to action is still the next step. */}
      {error ? <ErrorAlert error={error} /> : null}
    </div>
  );
}
