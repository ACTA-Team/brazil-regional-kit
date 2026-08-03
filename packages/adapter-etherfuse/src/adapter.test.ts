import { describe, expect, it } from 'vitest';
import { BRL, TESOURO, USDC, isTerminal } from '@brk/ramp-core';
import { createEtherfuseAdapter, mapStatus, toEtherfuseAsset } from './adapter';
import { isValidPixPayload } from './pix';

const ACCOUNT = 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4';

/** No latency, no waiting — these must run fast in CI. */
const adapter = () =>
  createEtherfuseAdapter({
    mode: 'mock',
    customerId: 'cus_test',
    bankAccountId: 'bank_test',
    mockOptions: { latencyMs: [0, 0], settlementMs: 40 },
  });

describe('asset translation', () => {
  it('maps fiat to a bare code and Stellar assets to CODE:ISSUER', () => {
    expect(toEtherfuseAsset(BRL)).toBe('BRL');
    expect(toEtherfuseAsset(TESOURO)).toBe(
      'TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4',
    );
    expect(toEtherfuseAsset('stellar:native')).toBe('XLM');
  });
});

describe('status mapping', () => {
  it('maps the known vocabulary', () => {
    expect(mapStatus('PENDING_PAYMENT')).toBe('awaiting_payment');
    expect(mapStatus('AWAITING_CRYPTO')).toBe('awaiting_signature');
    expect(mapStatus('COMPLETED')).toBe('completed');
    expect(mapStatus('FAILED')).toBe('failed');
    expect(mapStatus('EXPIRED')).toBe('expired');
  });

  it('is case insensitive', () => {
    expect(mapStatus('completed')).toBe('completed');
  });

  /**
   * If an anchor invents a new intermediate state, stalling the UI is the worst
   * acceptable outcome. Telling a user their money failed when it is merely
   * somewhere unfamiliar is not.
   */
  it('maps an unknown status to processing, never to failed', () => {
    expect(mapStatus('SOME_NEW_STATE')).toBe('processing');
    expect(mapStatus('')).toBe('processing');
  });
});

describe('capabilities', () => {
  it('reports mock mode', () => {
    const caps = adapter().capabilities();
    expect(caps.id).toBe('etherfuse');
    expect(caps.mode).toBe('mock');
    expect(caps.note).toMatch(/fixtures/i);
  });

  it('serves Brazil over PIX in both directions', () => {
    const br = adapter()
      .capabilities()
      .corridors.filter((c) => c.country === 'BR');
    // TESOURO and USDC, each way.
    expect(br).toHaveLength(4);
    expect([...new Set(br.map((c) => c.direction))].sort()).toEqual(['offramp', 'onramp']);
    expect(br.every((c) => c.rail === 'PIX')).toBe(true);
  });

  /**
   * The Mexican corridor is real, not aspirational — MEXe and CETES were
   * confirmed against the live sandbox. The 500 cap is the sandbox's own,
   * enforced with a `SandboxAmountExceeded` error.
   */
  it('serves Mexico over SPEI, capped at the sandbox limit', () => {
    const mx = adapter()
      .capabilities()
      .corridors.filter((c) => c.country === 'MX');
    // MEXe and USDC, each way.
    expect(mx).toHaveLength(4);
    expect(mx.every((c) => c.rail === 'SPEI')).toBe(true);
    // Sandbox on-ramps from MXN are capped at 500 by the anchor itself.
    expect(mx.filter((c) => c.direction === 'onramp').every((c) => c.max === '500')).toBe(true);
  });
});

describe('live response contract', () => {
  /**
   * The sandbox issues its own quote id and ignores the one it was sent. An
   * order that references the request's id fails with an unknown quote, so the
   * simulator has to behave the same way or the bug only appears in production.
   */
  it('returns the anchor’s quote id, not the one we generated', async () => {
    const a = adapter();
    const quote = await a.getQuote({
      sellAsset: BRL,
      buyAsset: TESOURO,
      sellAmount: '500',
      account: ACCOUNT,
    });

    // Whatever id came back must be the one an order can be created against.
    const order = await a.createOrder({ quoteId: quote.id, account: ACCOUNT });
    expect(order.quoteId).toBe(quote.id);
  });
});

describe('on-ramp lifecycle', () => {
  it('quotes, orders, issues a valid PIX code and settles', async () => {
    const a = adapter();

    const quote = await a.getQuote({
      sellAsset: BRL,
      buyAsset: TESOURO,
      sellAmount: '500',
      account: ACCOUNT,
      country: 'BR',
    });

    expect(quote.direction).toBe('onramp');
    expect(quote.mode).toBe('mock');
    expect(Number(quote.buyAmount)).toBeGreaterThan(0);
    expect(Number(quote.fee.amount)).toBeGreaterThan(0);
    expect(new Date(quote.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const order = await a.createOrder({ quoteId: quote.id, account: ACCOUNT });
    expect(order.status).toBe('awaiting_payment');
    expect(order.paymentInstructions?.type).toBe('pix');

    const pix = order.paymentInstructions;
    if (pix?.type !== 'pix') throw new Error('expected PIX instructions');
    expect(isValidPixPayload(pix.code)).toBe(true);

    await a.simulateFiatReceived(order.id);

    // Settlement is time-based, so the UI has something to animate.
    let current = await a.getOrder(order.id);
    for (let i = 0; i < 20 && !isTerminal(current.status); i++) {
      await new Promise((r) => setTimeout(r, 10));
      current = await a.getOrder(order.id);
    }
    expect(current.status).toBe('completed');
  });
});

describe('off-ramp lifecycle', () => {
  it('produces an order that names the account to return the asset to', async () => {
    const a = adapter();

    const quote = await a.getQuote({
      sellAsset: TESOURO,
      buyAsset: BRL,
      sellAmount: '100',
      account: ACCOUNT,
      country: 'BR',
    });
    expect(quote.direction).toBe('offramp');

    const order = await a.createOrder({ quoteId: quote.id, account: ACCOUNT });
    expect(order.status).toBe('awaiting_signature');
    expect(order.anchorAccount).toMatch(/^G/);
  });
});

describe('guard rails', () => {
  it('rejects a corridor it does not serve', async () => {
    // EUR is not a currency Etherfuse ramps from.
    await expect(
      adapter().getQuote({
        sellAsset: 'iso4217:EUR',
        buyAsset: USDC,
        sellAmount: '500',
        account: ACCOUNT,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAIR' });
  });

  /**
   * A ramp is not an exchange: the anchor answers an on-chain-to-on-chain quote
   * with `expected MXN or BRL`, so the adapter refuses before the round trip.
   */
  it('refuses a quote with fiat on neither side', async () => {
    await expect(
      adapter().getQuote({
        sellAsset: TESOURO,
        buyAsset: USDC,
        sellAmount: '100',
        account: ACCOUNT,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAIR' });
  });

  it('rejects an amount below the minimum', async () => {
    await expect(
      adapter().getQuote({ sellAsset: BRL, buyAsset: TESOURO, sellAmount: '1', account: ACCOUNT }),
    ).rejects.toMatchObject({ code: 'AMOUNT_OUT_OF_RANGE' });
  });

  it('requires a sell amount', async () => {
    await expect(
      adapter().getQuote({ sellAsset: BRL, buyAsset: TESOURO, account: ACCOUNT }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('rejects a passkey wallet’s C… contract address with an explanation', async () => {
    const a = adapter();
    const quote = await a.getQuote({
      sellAsset: BRL,
      buyAsset: TESOURO,
      sellAmount: '500',
      account: ACCOUNT,
    });

    await expect(
      a.createOrder({
        quoteId: quote.id,
        account: 'CDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    await expect(
      a.createOrder({
        quoteId: quote.id,
        account: 'CDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4',
      }),
    ).rejects.toThrow(/classic G/i);
  });

  it('rejects an order against an unknown quote', async () => {
    await expect(
      adapter().createOrder({ quoteId: 'nope', account: ACCOUNT }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
