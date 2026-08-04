import { describe, expect, it } from 'vitest';
import { USDC } from '@brk/ramp-core';
import { X402_VERSION, createX402Guard, memoFor } from './x402';

const PAY_TO = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const guard = () =>
  createX402Guard({ payTo: PAY_TO, asset: USDC, price: '0.10', description: 'Test resource' });

describe('payment terms', () => {
  it('produces a machine-readable challenge', () => {
    const challenge = guard().challenge('/api/thing');

    expect(challenge.x402Version).toBe(X402_VERSION);
    expect(challenge.accepts).toHaveLength(1);
    expect(challenge.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'stellar-testnet',
      asset: USDC,
      assetCode: 'USDC',
      amount: '0.10',
      payTo: PAY_TO,
      resource: '/api/thing',
    });
  });

  it('carries the reason when a payment was rejected, so the client can fix it', () => {
    expect(guard().challenge('/api/thing', 'Payment already used').error).toBe(
      'Payment already used',
    );
  });
});

describe('resource binding', () => {
  /**
   * A derived memo lets a client compute it, pay, and retry without the server
   * holding per-request state — while still tying the payment to one resource.
   */
  it('is deterministic for a resource', () => {
    expect(memoFor('/api/premium-fx')).toBe(memoFor('/api/premium-fx'));
  });

  it('differs between resources, so a cheap payment cannot unlock a dear one', () => {
    expect(memoFor('/api/premium-fx')).not.toBe(memoFor('/api/premium-something-else'));
  });

  it('always fits Stellar’s 28-byte memo limit', () => {
    const long = `/api/${'very-long-segment/'.repeat(40)}resource`;
    expect(new TextEncoder().encode(memoFor(long)).length).toBeLessThanOrEqual(28);
  });

  it('is namespaced so it is recognisable on-chain', () => {
    expect(memoFor('/api/thing')).toMatch(/^x402:/);
  });

  it('matches the memo the challenge demands', () => {
    expect(guard().requirement('/api/thing').memo).toBe(memoFor('/api/thing'));
  });
});

describe('configuration', () => {
  it('is asset-agnostic — pricing in a regional stablecoin is one field', () => {
    const tesouro = createX402Guard({
      payTo: PAY_TO,
      asset: 'stellar:TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4',
      price: '1.5',
    });

    expect(tesouro.requirement('/x').assetCode).toBe('TESOURO');
    expect(tesouro.requirement('/x').amount).toBe('1.5');
  });

  it('defaults to a five-minute payment window', () => {
    expect(guard().requirement('/x').maxTimeoutSeconds).toBe(300);
  });

  it('honours a custom window', () => {
    const short = createX402Guard({
      payTo: PAY_TO,
      asset: USDC,
      price: '1',
      maxTimeoutSeconds: 30,
    });
    expect(short.requirement('/x').maxTimeoutSeconds).toBe(30);
  });
});

describe('verification guard rails', () => {
  /**
   * The happy path needs a real transaction on a real ledger, so it is exercised
   * by the running app rather than here. What a unit test must pin down is the
   * failure direction: an unverifiable payment is never optimistically accepted.
   *
   * Pointed at an unreachable Horizon so the suite stays hermetic — that also
   * covers the case that matters most operationally, which is Horizon being down.
   */
  const guardFor = (horizonUrl: string) =>
    createX402Guard({
      payTo: PAY_TO,
      asset: USDC,
      price: '0.10',
      network: { horizonUrl, networkPassphrase: 'Test SDF Network ; September 2015' },
    });

  it('rejects rather than accepts when Horizon is unreachable', async () => {
    await expect(
      guardFor('https://127.0.0.1:1').verify('0'.repeat(64), '/api/thing'),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  /** A misconfigured Horizon URL must still produce a normalized RampError. */
  it('normalizes a client-construction failure instead of leaking a raw Error', async () => {
    await expect(
      guardFor('http://127.0.0.1:1').verify('0'.repeat(64), '/api/thing'),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
