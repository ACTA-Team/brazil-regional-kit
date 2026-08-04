'use client';

import { useI18n } from '@/lib/i18n';
import { shortAddress, useWallet } from '@/lib/wallet';
import { ICON_WEIGHT, Warning } from './icons';

export function WalletButton() {
  const { t } = useI18n();
  const { status, address, connect, openProfile } = useWallet();

  if (status === 'unavailable') {
    return (
      <a
        href="https://stellar.org/ecosystem/wallets"
        target="_blank"
        rel="noreferrer"
        title={t('wallet.installPrompt')}
        className="btn btn-outline btn-sm"
      >
        {t('wallet.notInstalled')}
      </a>
    );
  }

  if (status === 'connected') {
    // The kit owns the account modal — copy address, switch wallet, disconnect.
    return (
      <button
        type="button"
        onClick={() => void openProfile()}
        title={address}
        className="btn btn-outline btn-sm font-mono"
      >
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        {shortAddress(address)}
      </button>
    );
  }

  /*
   * Connecting is the primary action of an empty screen, so it earns gold. On
   * pages that have their own primary action the wallet is already connected
   * and this renders as the outline variant above — the one-gold-per-screen
   * rule holds by construction.
   */
  return (
    <button
      type="button"
      onClick={() => void connect()}
      disabled={status === 'connecting' || status === 'checking'}
      className="btn btn-primary btn-sm"
    >
      {status === 'connecting' ? t('wallet.connecting') : t('wallet.connect')}
    </button>
  );
}

/**
 * Wallets default to mainnet. Every hackathon demo that skips this check
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
      className="animate-rise mb-4 flex items-center gap-3 rounded-xl border border-gold/40 bg-gold/8 px-4 py-3 text-sm text-gold"
    >
      <Warning size={16} weight={ICON_WEIGHT} className="shrink-0" aria-hidden="true" />
      {t('wallet.wrongNetwork', { network: network.network })}
    </div>
  );
}
