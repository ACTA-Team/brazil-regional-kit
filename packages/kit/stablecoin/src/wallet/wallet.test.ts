import { describe, expect, it } from 'vitest';
import { TESTNET_PASSPHRASE } from '@brk/ramp-core';
import {
  configureWalletKit,
  connectWallet,
  connectWalletById,
  disconnectWallet,
  getSelectedWalletId,
  getWalletAddress,
  getWalletNetwork,
  hasWalletAvailable,
  isTestnet,
  isWalletSessionLost,
  listWallets,
  openWalletProfile,
  signTransactionXdr,
  watchWallet,
} from './wallet';

describe('isWalletSessionLost', () => {
  /*
   * Lobstr answers `getAddress` from cache after its live connection to the
   * page is gone, so the app shows "connected" and then fails at the moment the
   * user clicks sign. Recognising that state is what lets the caller reconnect
   * and retry instead of surfacing wallet internals.
   */
  it.each([
    'The connection key is missing',
    'Wallet is not connected',
    'No connection to the extension',
    'Session has expired',
    'Unauthorized',
  ])('treats %j as a lost session', (message) => {
    expect(isWalletSessionLost(new Error(message))).toBe(true);
  });

  /*
   * A refusal must never match. Retrying it would re-prompt someone who has
   * already said no, which is how a demo turns into a wallet popup loop.
   */
  it.each([
    'User declined the request',
    'Request rejected by user',
    'Signature denied',
    'User cancelled',
  ])('does not treat %j as a lost session', (message) => {
    expect(isWalletSessionLost(new Error(message))).toBe(false);
  });

  it('handles non-Error values without throwing', () => {
    expect(isWalletSessionLost(undefined)).toBe(false);
    expect(isWalletSessionLost('the connection key is missing')).toBe(true);
  });
});

describe('isTestnet', () => {
  it('recognises the testnet passphrase', () => {
    expect(isTestnet({ network: 'TESTNET', networkPassphrase: TESTNET_PASSPHRASE })).toBe(true);
  });

  /** A wallet left on mainnet is the classic demo failure. It must not pass. */
  it('rejects any other network', () => {
    expect(
      isTestnet({
        network: 'PUBLIC',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      }),
    ).toBe(false);
  });
});

/**
 * This module is imported by server components, and the Stellar Wallets Kit
 * registers web components and touches `window` at import time. The contract is
 * that importing and calling it on a server fails cleanly rather than crashing
 * the render — these tests run in Node, with no `window`, which is exactly that
 * environment.
 */
describe('server safety', () => {
  it('can be configured on the server without touching the kit', () => {
    expect(() => configureWalletKit({ selectedWalletId: 'freighter' })).not.toThrow();
  });

  describe('calls that refuse outright', () => {
    it.each([
      ['listWallets', () => listWallets()],
      ['connectWallet', () => connectWallet()],
      ['connectWalletById', () => connectWalletById('freighter')],
      ['getWalletNetwork', () => getWalletNetwork()],
      ['signTransactionXdr', () => signTransactionXdr('AAAA')],
      ['disconnectWallet', () => disconnectWallet()],
      ['openWalletProfile', () => openWalletProfile()],
      ['watchWallet', () => watchWallet(() => {})],
    ])('%s reports that wallets are browser-only', async (_name, call) => {
      await expect(call()).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
        message: expect.stringMatching(/only available in the browser/i),
      });
    });
  });

  /**
   * These three are read during render to decide what to show. Throwing would
   * take the page down over a question whose honest answer is simply "nothing
   * is connected".
   */
  describe('reads that degrade instead of throwing', () => {
    it('reports no wallet available', async () => {
      await expect(hasWalletAvailable()).resolves.toBe(false);
    });

    it('reports no selected wallet', async () => {
      await expect(getSelectedWalletId()).resolves.toBeNull();
    });

    it('reports an empty address', async () => {
      await expect(getWalletAddress()).resolves.toBe('');
    });
  });
});
