'use client';

import { useI18n } from '@/lib/i18n';
import { shortAddress, useWallet } from '@/lib/wallet';

export function WalletButton() {
  const { t } = useI18n();
  const { status, address, connect, disconnect } = useWallet();

  if (status === 'unavailable') {
    return (
      <a
        href="https://www.freighter.app/"
        target="_blank"
        rel="noreferrer"
        title={t('wallet.installPrompt')}
        className="btn btn-ghost text-xs"
      >
        {t('wallet.notInstalled')}
      </a>
    );
  }

  if (status === 'connected') {
    return (
      <button
        type="button"
        onClick={disconnect}
        title={address}
        className="btn btn-ghost font-mono text-xs"
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-400" />
        {shortAddress(address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void connect()}
      disabled={status === 'connecting' || status === 'checking'}
      className="btn btn-primary text-xs"
    >
      {status === 'connecting' ? t('wallet.connecting') : t('wallet.connect')}
    </button>
  );
}

/**
 * Freighter defaults to mainnet. Every hackathon demo that skips this check
 * eventually signs a testnet transaction against the public network and spends
 * ten confused minutes on it.
 */
export function NetworkBanner() {
  const { t } = useI18n();
  const { status, network, onTestnet } = useWallet();

  if (status !== 'connected' || !network || onTestnet) return null;

  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-accent-500 bg-accent-500/10 px-4 py-3 text-sm text-accent-300"
    >
      {t('wallet.wrongNetwork', { network: network.network })}
    </div>
  );
}
