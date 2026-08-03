/**
 * Freighter wrapper.
 *
 * Two things this adds over calling `@stellar/freighter-api` directly:
 *
 *  1. Freighter v4+ *returns* `{ error }` instead of throwing. Every call site
 *     that forgets to check gets `undefined` where an address should be and
 *     fails somewhere far away. Here, an error becomes a thrown `RampError`.
 *  2. The module touches `window` at import time, so it is dynamically imported
 *     inside each call — safe to import this file from a server component.
 */

import { RampError, TESTNET_PASSPHRASE } from '@brk/ramp-core';

type FreighterModule = typeof import('@stellar/freighter-api');

let modulePromise: Promise<FreighterModule> | null = null;

async function freighter(): Promise<FreighterModule> {
  if (typeof window === 'undefined') {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: 'Freighter is only available in the browser.',
    });
  }
  modulePromise ??= import('@stellar/freighter-api');
  return modulePromise;
}

/** Freighter's error payloads are `{ message, code? }`. Normalize them. */
function raise(error: unknown, fallback: string): never {
  const message =
    (error as { message?: string } | undefined)?.message ??
    (typeof error === 'string' ? error : fallback);
  throw new RampError({ code: 'INVALID_REQUEST', message, raw: error });
}

export interface WalletNetwork {
  network: string;
  networkPassphrase: string;
  networkUrl?: string;
}

export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const api = await freighter();
    const res = await api.isConnected();
    return Boolean(res.isConnected);
  } catch {
    return false;
  }
}

/** Opens Freighter's approval popup the first time; resolves to the address. */
export async function connectWallet(): Promise<string> {
  const api = await freighter();
  const res = await api.requestAccess();
  if (res.error || !res.address) raise(res.error, 'Freighter denied the connection request.');
  return res.address;
}

/** Address without prompting — empty string when the site is not yet approved. */
export async function getWalletAddress(): Promise<string> {
  const api = await freighter();
  const res = await api.getAddress();
  if (res.error) return '';
  return res.address ?? '';
}

export async function getWalletNetwork(): Promise<WalletNetwork> {
  const api = await freighter();
  const res = await api.getNetworkDetails();
  if (res.error) raise(res.error, 'Could not read the Freighter network.');
  return {
    network: res.network,
    networkPassphrase: res.networkPassphrase,
    networkUrl: res.networkUrl,
  };
}

export const isTestnet = (n: WalletNetwork): boolean => n.networkPassphrase === TESTNET_PASSPHRASE;

export interface SignOptions {
  networkPassphrase?: string;
  /** Pin the signer, so a wallet with several accounts cannot sign as the wrong one. */
  address?: string;
}

/**
 * Sign an unsigned XDR. Used for the on-ramp trustline claim, the off-ramp
 * return payment, the DEX swap and the remittance — every signature in the kit
 * funnels through here.
 */
export async function signTransactionXdr(xdr: string, opts: SignOptions = {}): Promise<string> {
  const api = await freighter();
  const res = await api.signTransaction(xdr, {
    networkPassphrase: opts.networkPassphrase ?? TESTNET_PASSPHRASE,
    ...(opts.address ? { address: opts.address } : {}),
  });
  if (res.error || !res.signedTxXdr) {
    raise(res.error, 'Freighter did not return a signed transaction.');
  }
  return res.signedTxXdr;
}

/**
 * Notify when the user switches account or network in the extension. Returning
 * a stale address after the user switched wallets is a classic demo failure.
 */
export async function watchWallet(
  onChange: (state: { address: string; network: string }) => void,
): Promise<() => void> {
  const api = await freighter();
  const watcher = new api.WatchWalletChanges(2000);
  watcher.watch(onChange);
  return () => watcher.stop();
}
