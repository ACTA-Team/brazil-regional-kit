import { describe, expect, it } from 'vitest';
import { isWalletSessionLost } from './wallet';

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
