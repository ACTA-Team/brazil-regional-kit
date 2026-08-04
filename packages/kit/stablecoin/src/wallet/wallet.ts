/**
 * Wallet access, through Stellar Wallets Kit.
 *
 * Talking to Freighter directly was the shorter path, and it was the wrong one
 * for a kit whose whole argument is "one interface, many providers". The same
 * reasoning that puts four anchors behind `ramp-router` puts every wallet
 * behind one connect call: a Brazilian user is as likely to have Lobstr or
 * xBull as Freighter, and an integration that only speaks to one of them is an
 * integration that turns users away.
 *
 * Only browser-extension and web modules are registered. Hardware wallets and
 * WalletConnect are deliberately left out — they drag in native build steps and
 * a WalletConnect project id, neither of which a ramp demo needs.
 *
 * The kit touches `window` and registers web components at import time, so it
 * is dynamically imported inside each call. This file is safe to import from a
 * server component.
 */

import { RampError, TESTNET_PASSPHRASE } from '@brk/ramp-core';

type KitModule = typeof import('@creit.tech/stellar-wallets-kit');

let kitPromise: Promise<KitModule> | null = null;

export interface WalletKitOptions {
  /** Defaults to testnet — this kit is a testnet development tool. */
  networkPassphrase?: string;
  /** Restore a previously selected wallet without prompting. */
  selectedWalletId?: string;
}

let initOptions: WalletKitOptions = {};

/** Set before the first wallet call to restore a remembered wallet. */
export function configureWalletKit(options: WalletKitOptions): void {
  initOptions = { ...initOptions, ...options };
}

/**
 * Load and initialise the kit exactly once. `init` is not idempotent in the
 * library, so the promise itself is the guard.
 */
async function kit(): Promise<KitModule> {
  if (typeof window === 'undefined') {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: 'Wallets are only available in the browser.',
    });
  }

  kitPromise ??= (async () => {
    const mod = await import('@creit.tech/stellar-wallets-kit');
    const [
      { FreighterModule },
      { xBullModule },
      { AlbedoModule },
      { RabetModule },
      { LobstrModule },
      { HanaModule },
    ] = await Promise.all([
      import('@creit.tech/stellar-wallets-kit/modules/freighter'),
      import('@creit.tech/stellar-wallets-kit/modules/xbull'),
      import('@creit.tech/stellar-wallets-kit/modules/albedo'),
      import('@creit.tech/stellar-wallets-kit/modules/rabet'),
      import('@creit.tech/stellar-wallets-kit/modules/lobstr'),
      import('@creit.tech/stellar-wallets-kit/modules/hana'),
    ]);

    mod.StellarWalletsKit.init({
      modules: [
        new FreighterModule(),
        new xBullModule(),
        new AlbedoModule(),
        new RabetModule(),
        new LobstrModule(),
        new HanaModule(),
      ],
      network: toKitNetwork(mod, initOptions.networkPassphrase),
      selectedWalletId: initOptions.selectedWalletId,
      authModal: { showInstallLabel: true },
    });

    return mod;
  })();

  return kitPromise;
}

/**
 * The kit's `Networks` enum has passphrases as its *values*, so a passphrase
 * can be matched against it directly rather than maintaining a lookup table
 * that would silently rot when a new network is added.
 */
function toKitNetwork(
  mod: KitModule,
  passphrase: string | undefined,
): KitModule['Networks'][keyof KitModule['Networks']] {
  const values = Object.values(mod.Networks);
  const match = values.find((v) => v === (passphrase ?? TESTNET_PASSPHRASE));
  return match ?? mod.Networks.TESTNET;
}

/** The kit throws `{ code, message }` rather than an `Error`. Normalize it. */
function raise(cause: unknown, fallback: string): never {
  const message =
    (cause as { message?: string } | undefined)?.message ??
    (cause instanceof Error ? cause.message : fallback);
  throw new RampError({ code: 'INVALID_REQUEST', message, cause });
}

export interface WalletNetwork {
  network: string;
  networkPassphrase: string;
}

export interface SupportedWallet {
  id: string;
  name: string;
  isAvailable: boolean;
  icon: string;
  url: string;
}

/** Every wallet the kit knows about, and whether it is actually installed. */
export async function listWallets(): Promise<SupportedWallet[]> {
  const { StellarWalletsKit } = await kit();
  const wallets = await StellarWalletsKit.refreshSupportedWallets();
  return wallets.map((w) => ({
    id: w.id,
    name: w.name,
    isAvailable: w.isAvailable,
    icon: w.icon,
    url: w.url,
  }));
}

/** True when at least one supported wallet is installed. */
export async function hasWalletAvailable(): Promise<boolean> {
  try {
    return (await listWallets()).some((w) => w.isAvailable);
  } catch {
    return false;
  }
}

/**
 * Open the wallet picker and connect. The kit owns the modal, which is the
 * point — the list stays correct as wallets come and go without us maintaining
 * detection logic for each one.
 */
export async function connectWallet(): Promise<string> {
  const { StellarWalletsKit } = await kit();
  try {
    const { address } = await StellarWalletsKit.authModal();
    if (!address) raise(undefined, 'No wallet was selected.');
    return address;
  } catch (cause) {
    raise(cause, 'Connection was cancelled.');
  }
}

/**
 * Which wallet is currently selected, e.g. `freighter`, `lobstr`.
 *
 * Persist it and pass it back through `configureWalletKit` and the next visit
 * reconnects without showing the picker again.
 */
export async function getSelectedWalletId(): Promise<string | null> {
  try {
    const { StellarWalletsKit } = await kit();
    return StellarWalletsKit.selectedModule?.productId ?? null;
  } catch {
    return null;
  }
}

/** Connect to a specific wallet without showing the picker. */
export async function connectWalletById(walletId: string): Promise<string> {
  const { StellarWalletsKit } = await kit();
  try {
    StellarWalletsKit.setWallet(walletId);
    const { address } = await StellarWalletsKit.fetchAddress();
    return address;
  } catch (cause) {
    raise(cause, `Could not connect to ${walletId}.`);
  }
}

/** The address already in the kit's memory. Empty when nothing is connected. */
export async function getWalletAddress(): Promise<string> {
  try {
    const { StellarWalletsKit } = await kit();
    const { address } = await StellarWalletsKit.getAddress();
    return address ?? '';
  } catch {
    return '';
  }
}

export async function getWalletNetwork(): Promise<WalletNetwork> {
  const { StellarWalletsKit } = await kit();
  try {
    return await StellarWalletsKit.getNetwork();
  } catch (cause) {
    raise(cause, 'Could not read the wallet network.');
  }
}

export const isTestnet = (n: WalletNetwork): boolean => n.networkPassphrase === TESTNET_PASSPHRASE;

export interface SignOptions {
  networkPassphrase?: string;
  /** Pin the signer, so a wallet with several accounts cannot sign as the wrong one. */
  address?: string;
}

/**
 * Sign an unsigned XDR. Every signature in this kit funnels through here — the
 * on-ramp trustline claim, the off-ramp return payment, the DEX swap, the
 * remittance and the x402 payment.
 */
export async function signTransactionXdr(xdr: string, opts: SignOptions = {}): Promise<string> {
  const { StellarWalletsKit } = await kit();
  try {
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: opts.networkPassphrase ?? TESTNET_PASSPHRASE,
      ...(opts.address ? { address: opts.address } : {}),
    });
    if (!signedTxXdr) raise(undefined, 'The wallet returned no signed transaction.');
    return signedTxXdr;
  } catch (cause) {
    raise(cause, 'The wallet did not sign the transaction.');
  }
}

/**
 * Sign an arbitrary message, for proof of control rather than for a payment.
 *
 * Separate from `signTransactionXdr` because it is a genuinely different act:
 * nothing is submitted, nothing moves, and the signature proves possession of a
 * key rather than authorising a transfer.
 *
 * **Not every wallet implements it**, and the ones that do are not consistent
 * about what they sign — some hash the message first, some prepend a prefix.
 * That is why this returns `null` for an unsupported wallet instead of throwing:
 * the caller can then say so plainly rather than showing a wallet-internal
 * string, and a signature that comes back but does not verify is a wallet
 * disagreeing about the format, not a wrong key.
 */
export async function signMessageWithWallet(
  message: string,
  opts: SignOptions = {},
): Promise<string | null> {
  const { StellarWalletsKit } = await kit();

  if (typeof StellarWalletsKit.signMessage !== 'function') return null;

  try {
    const { signedMessage } = await StellarWalletsKit.signMessage(message, {
      networkPassphrase: opts.networkPassphrase ?? TESTNET_PASSPHRASE,
      ...(opts.address ? { address: opts.address } : {}),
    });
    if (!signedMessage) return null;
    // Wallets differ on the return type: some hand back base64, some raw bytes.
    return typeof signedMessage === 'string'
      ? signedMessage
      : Buffer.from(signedMessage).toString('base64');
  } catch (cause) {
    // A user who declines is not an unsupported wallet, and the caller needs to
    // tell those apart.
    if (/declin|reject|denied|cancel/i.test(String((cause as Error)?.message ?? cause))) {
      raise(cause, 'The wallet did not sign the message.');
    }
    return null;
  }
}

/**
 * Whether an error means the wallet has forgotten this site, rather than that
 * the user said no.
 *
 * Wallets separate reading an address from authorising a signature. Lobstr in
 * particular keeps answering `getAddress` from cache long after the live
 * connection to the page is gone, so the app believes it is connected and then
 * fails at the one moment that matters with "The connection key is missing" —
 * a string that means nothing to the person reading it.
 *
 * Recognising the state is what lets a caller reconnect and retry instead of
 * showing wallet internals. A user-declined signature must NOT match: retrying
 * that would re-prompt someone who already said no.
 */
export function isWalletSessionLost(error: unknown): boolean {
  const message = (
    (error as { message?: string } | undefined)?.message ?? String(error ?? '')
  ).toLowerCase();

  if (/declin|reject|denied|cancel/.test(message)) return false;

  return /connection key|not connected|no connection|session (has )?expired|unauthori[sz]ed/.test(
    message,
  );
}

export async function disconnectWallet(): Promise<void> {
  const { StellarWalletsKit } = await kit();
  try {
    await StellarWalletsKit.disconnect();
  } catch {
    // Disconnecting is best-effort; a wallet that cannot be told is still gone
    // as far as this app is concerned.
  }
}

/** Show the kit's account modal — copy address, switch wallet, disconnect. */
export async function openWalletProfile(): Promise<void> {
  const { StellarWalletsKit } = await kit();
  await StellarWalletsKit.profileModal();
}

/**
 * Notify when the user switches account, network or wallet in their extension.
 * Returning a stale address after the user switched is a classic demo failure.
 */
export async function watchWallet(
  onChange: (state: { address: string; networkPassphrase: string }) => void,
): Promise<() => void> {
  const { StellarWalletsKit, KitEventType } = await kit();

  const unsubscribeState = StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
    onChange({
      address: event.payload.address ?? '',
      networkPassphrase: event.payload.networkPassphrase,
    });
  });

  const unsubscribeDisconnect = StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
    onChange({ address: '', networkPassphrase: TESTNET_PASSPHRASE });
  });

  return () => {
    unsubscribeState();
    unsubscribeDisconnect();
  };
}
