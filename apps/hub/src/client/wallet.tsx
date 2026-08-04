'use client';

/**
 * Wallet state for the whole app.
 *
 * Connection goes through Stellar Wallets Kit, so the user picks from every
 * wallet they might actually have — Freighter, Lobstr, xBull, Albedo, Rabet,
 * Hana — rather than being told which one to install. Same argument as the
 * anchor router: one interface, many providers.
 *
 * Beyond "which address is connected", this tracks two things that decide
 * whether a demo works or dies on stage: whether the wallet is pointed at
 * testnet, and whether the account actually holds a trustline for the asset a
 * flow is about to deliver. Both are checked against the live network even when
 * the anchor is in mock mode — the chain half of this demo is always real.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  configureWalletKit,
  connectWallet,
  disconnectWallet,
  getBalances,
  getWalletAddress,
  getSelectedWalletId,
  getWalletNetwork,
  hasWalletAvailable,
  isTestnet,
  isWalletSessionLost,
  openWalletProfile,
  signTransactionXdr,
  watchWallet,
  type Balance,
  type WalletNetwork,
} from '@brk/stablecoin-kit';
import { TESTNET_PASSPHRASE, type AssetId } from '@brk/ramp-core';

/**
 * The wallet dialogs, in this app's colours.
 *
 * Stellar Wallets Kit renders its picker and profile dialogs inside a shadow
 * root, so nothing in `globals.css` can reach them — the only way in is this
 * object. Without it they arrive in the library's light theme: a white card
 * over a black page, which is what a broken integration looks like.
 *
 * Literal values rather than `var(--color-gold)`: custom properties resolve
 * against the element they are used on, and inside the kit's shadow root this
 * app's `:root` variables are not in scope. These are the same colours
 * `globals.css` declares, written out.
 */
const WALLET_DIALOG_THEME = {
  background: '#0a0d14',
  'background-secondary': '#11151e',
  'foreground-strong': '#ededed',
  foreground: 'rgba(237, 237, 237, 0.78)',
  'foreground-secondary': 'rgba(237, 237, 237, 0.55)',
  primary: 'oklch(0.86 0.17 96)',
  'primary-foreground': '#12100a',
  transparent: 'transparent',
  lighter: 'rgba(255, 255, 255, 0.06)',
  light: 'rgba(255, 255, 255, 0.09)',
  'light-gray': 'rgba(255, 255, 255, 0.14)',
  gray: 'rgba(237, 237, 237, 0.38)',
  danger: 'oklch(0.68 0.2 22)',
  border: 'rgba(255, 255, 255, 0.12)',
  shadow: 'rgba(0, 0, 0, 0.6)',
  'border-radius': '12px',
  'font-family': "var(--font-space-grotesk), 'Space Grotesk', Helvetica, sans-serif",
} as const;

export type WalletStatus = 'idle' | 'checking' | 'connecting' | 'connected' | 'unavailable';

interface WalletValue {
  status: WalletStatus;
  address: string;
  network: WalletNetwork | null;
  onTestnet: boolean;
  balances: Balance[] | null;
  /** True when the account is not funded yet. */
  unfunded: boolean;
  error: string | null;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** The kit's own account modal — copy address, switch wallet, disconnect. */
  openProfile: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  sign: (xdr: string) => Promise<string>;
  balanceOf: (asset: AssetId) => string;
  hasTrustline: (asset: AssetId) => boolean;
}

const WalletContext = createContext<WalletValue | null>(null);

const ADDRESS_KEY = 'brk.wallet.address';
/** Which wallet the user picked, so the kit can reconnect without the modal. */
const WALLET_ID_KEY = 'brk.wallet.id';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>('idle');
  const [address, setAddress] = useState('');
  const [network, setNetwork] = useState<WalletNetwork | null>(null);
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [unfunded, setUnfunded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBalances = useCallback(async (addr: string) => {
    if (!addr) return;
    try {
      const result = await getBalances(addr);
      setBalances(result ?? []);
      setUnfunded(result === null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const readNetwork = useCallback(async () => {
    try {
      setNetwork(await getWalletNetwork());
    } catch {
      setNetwork(null);
    }
  }, []);

  // Reconnect silently when the user has already chosen a wallet.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setStatus('checking');

      const rememberedWallet = window.localStorage.getItem(WALLET_ID_KEY);
      configureWalletKit({
        networkPassphrase: TESTNET_PASSPHRASE,
        theme: WALLET_DIALOG_THEME,
        ...(rememberedWallet ? { selectedWalletId: rememberedWallet } : {}),
      });

      if (!(await hasWalletAvailable())) {
        if (!cancelled) setStatus('unavailable');
        return;
      }

      // Only try to restore a session the user actually started; asking a
      // wallet for an address unprompted makes some extensions pop a dialog.
      if (!rememberedWallet) {
        if (!cancelled) setStatus('idle');
        return;
      }

      const current = await getWalletAddress();
      if (cancelled) return;

      if (current) {
        setAddress(current);
        setStatus('connected');
        void readNetwork();
        void loadBalances(current);
      } else {
        setStatus('idle');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadBalances, readNetwork]);

  /*
   * Re-read balances on every screen change.
   *
   * Balances were loaded once, at connect. Anything that changed them
   * afterwards — an on-ramp settling, a swap filling, a payment sent from
   * another tab — left the next screen deciding against a stale number. The
   * corridor would say "not enough TESOURO" while the wallet plainly held some,
   * which reads as the app being broken rather than out of date.
   *
   * One Horizon call per navigation is cheap, and it makes every screen answer
   * for what is true now instead of what was true when the wallet connected.
   */
  const pathname = usePathname();
  useEffect(() => {
    if (status !== 'connected' || !address) return;
    // Deferred a tick so the fetch's setState never lands synchronously inside
    // the effect body.
    const id = setTimeout(() => void loadBalances(address), 0);
    return () => clearTimeout(id);
  }, [pathname, status, address, loadBalances]);

  // Account, network or wallet switches in the extension must reach the UI, or
  // the demo keeps showing a wallet the user has already moved away from.
  useEffect(() => {
    if (status !== 'connected') return;
    let stop: (() => void) | undefined;
    let cancelled = false;

    void watchWallet(({ address: next, networkPassphrase }) => {
      if (cancelled) return;

      if (!next) {
        setAddress('');
        setBalances(null);
        setStatus('idle');
        return;
      }

      setNetwork((current) =>
        current?.networkPassphrase === networkPassphrase
          ? current
          : {
              network: networkPassphrase === TESTNET_PASSPHRASE ? 'TESTNET' : 'OTHER',
              networkPassphrase,
            },
      );

      if (next !== address) {
        setAddress(next);
        window.localStorage.setItem(ADDRESS_KEY, next);
        void loadBalances(next);
      }
    }).then((s) => {
      if (cancelled) s();
      else stop = s;
    });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [status, address, loadBalances]);

  const connect = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      const addr = await connectWallet();
      setAddress(addr);
      window.localStorage.setItem(ADDRESS_KEY, addr);

      // Remember the chosen wallet so the next visit skips the picker.
      const selected = await getSelectedWalletId();
      if (selected) window.localStorage.setItem(WALLET_ID_KEY, selected);

      setStatus('connected');
      await Promise.all([readNetwork(), loadBalances(addr)]);
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadBalances, readNetwork]);

  const disconnect = useCallback(async () => {
    await disconnectWallet();
    window.localStorage.removeItem(ADDRESS_KEY);
    window.localStorage.removeItem(WALLET_ID_KEY);
    setAddress('');
    setBalances(null);
    setNetwork(null);
    setStatus('idle');
  }, []);

  const value = useMemo<WalletValue>(() => {
    const balanceOf = (asset: AssetId) => balances?.find((b) => b.asset === asset)?.balance ?? '0';

    return {
      status,
      address,
      network,
      onTestnet: network ? isTestnet(network) : false,
      balances,
      unfunded,
      error,
      connect,
      disconnect,
      openProfile: openWalletProfile,
      refreshBalances: () => loadBalances(address),
      sign: async (xdr: string) => {
        const opts = {
          networkPassphrase: network?.networkPassphrase ?? TESTNET_PASSPHRASE,
          address,
        };

        try {
          return await signTransactionXdr(xdr, opts);
        } catch (e) {
          if (!isWalletSessionLost(e)) throw e;

          /*
           * The wallet still knows the address but has dropped its live
           * connection to this page, so it reports something like "The
           * connection key is missing" at the exact moment the user clicks
           * sign. Reconnecting is the whole remedy, and making the user work
           * that out from a wallet-internal string is not a reasonable ask.
           */
          await connectWallet();
          return await signTransactionXdr(xdr, opts);
        }
      },
      balanceOf,
      hasTrustline: (asset: AssetId) => Boolean(balances?.some((b) => b.asset === asset)),
    };
  }, [status, address, network, balances, unfunded, error, connect, disconnect, loadBalances]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}

export const shortAddress = (a: string): string =>
  a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-5)}` : a;
