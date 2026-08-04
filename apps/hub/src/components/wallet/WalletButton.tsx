'use client';

import { useI18n } from '@/client/i18n';
import { shortAddress, useWallet } from '@/client/wallet';
import { ICON_WEIGHT, Warning } from '@/components/icons';

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
        className="btn btn-outline btn-sm rounded-full"
      >
        {t('wallet.notInstalled')}
      </a>
    );
  }

  if (status === 'connected') {
    /*
     * Connected is a STATUS, so it wears the shape of one: a mono pill with a
     * lit verde dot, not a button. The kit still owns the account modal behind
     * it — copy address, switch wallet, disconnect — but nothing about it
     * should invite a click the way the gold Connect does.
     */
    return (
      <button
        type="button"
        onClick={() => void openProfile()}
        title={address}
        className="flex items-center gap-2.25 rounded-full border border-line-strong bg-white/3 px-4 py-2 font-mono text-xs text-fg transition-colors hover:border-white/24 hover:bg-white/6"
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background: 'oklch(0.75 0.19 152)',
            boxShadow: '0 0 12px oklch(0.75 0.19 152)',
          }}
        />
        {shortAddress(address)}
      </button>
    );
  }

  /*
   * Connecting is the primary action of an empty screen, so it earns gold. On
   * pages that have their own primary action the wallet is already connected
   * and this renders as the status pill above — the one-gold-per-screen rule
   * holds by construction.
   */
  return (
    <button
      type="button"
      onClick={() => void connect()}
      disabled={status === 'connecting' || status === 'checking'}
      className="btn btn-primary btn-sm rounded-full"
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
