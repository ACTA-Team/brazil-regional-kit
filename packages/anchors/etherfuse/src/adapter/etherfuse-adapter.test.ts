import { describe, expect, it } from 'vitest';
import { BRL, TESOURO, USDC, isTerminal } from '@brk/ramp-core';
import { createEtherfuseAdapter, mapStatus, toEtherfuseAsset } from './etherfuse-adapter';
import { isValidPixPayload } from '../pix/br-code';

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

describe('created orders are actionable', () => {
  /**
   * Etherfuse leaves a live order in `created` until money moves. Reporting
   * that verbatim left the UI on step one with nothing to click, which reads
   * as a hung integration rather than "your turn".
   */
  it('reads a created on-ramp as awaiting payment', () => {
    expect(mapStatus('CREATED', 'onramp')).toBe('awaiting_payment');
  });

  it('reads a created off-ramp as awaiting signature', () => {
    expect(mapStatus('CREATED', 'offramp')).toBe('awaiting_signature');
  });

  it('leaves it as created when the direction is unknown', () => {
    expect(mapStatus('CREATED')).toBe('created');
  });

  it('does not touch statuses that already say what is happening', () => {
    expect(mapStatus('PROCESSING', 'onramp')).toBe('processing');
    expect(mapStatus('COMPLETED', 'onramp')).toBe('completed');
    expect(mapStatus('FAILED', 'offramp')).toBe('failed');
  });

  it('surfaces payment instructions on a freshly created order', async () => {
    const a = adapter();
    const quote = await a.getQuote({
      sellAsset: BRL,
      buyAsset: TESOURO,
      sellAmount: '500',
      account: ACCOUNT,
    });
    const order = await a.createOrder({ quoteId: quote.id, account: ACCOUNT });

    expect(order.status).toBe('awaiting_payment');
    expect(order.paymentInstructions).toBeDefined();
  });
});

describe('acknowledge-only settlement hooks', () => {
  /**
   * The live fiat_received endpoint answers 200 with an empty body. Mapping
   * that emptiness as an order produced one with no id, which crashed the
   * first component that touched it — so the adapter must fall back to
   * fetching the order whenever a hook says nothing.
   */
  it('fetches the order when the hook returns an empty body', async () => {
    const backing = createEtherfuseAdapter({
      mode: 'mock',
      mockOptions: { latencyMs: [0, 0], settlementMs: 40 },
    });
    const quote = await backing.getQuote({
      sellAsset: BRL,
      buyAsset: TESOURO,
      sellAmount: '500',
      account: ACCOUNT,
    });
    const created = await backing.createOrder({ quoteId: quote.id, account: ACCOUNT });

    // Wrap the mock API so the settlement hook acknowledges like the live one.
    const inner = (backing as unknown as { api: import('../api/api').EtherfuseApi }).api;
    const acknowledgeOnly = createEtherfuseAdapter({
      mode: 'mock',
      api: {
        ...inner,
        mode: inner.mode,
        simulateFiatReceived: async (id) => {
          await inner.simulateFiatReceived(id);
          return {} as import('../api/api').EtherfuseOrderResponse; // 200, empty body
        },
        getOrder: (id) => inner.getOrder(id),
      },
    });

    const settled = await acknowledgeOnly.simulateFiatReceived(created.id);
    expect(settled.id).toBe(created.id);
    expect(settled.status).not.toBe('failed');
  });
});

describe('missing crypto_received route', () => {
  /**
   * The live sandbox 404s on POST /ramp/order/crypto_received for every order —
   * the route does not exist, because the crypto leg of an off-ramp is a real
   * on-chain payment even in sandbox and the anchor's watcher reconciles it by
   * memo. A 404 from the hook is therefore "nothing to simulate", not a
   * failure, and must resolve to the order's actual state.
   */
  it('falls back to the order when the hook 404s', async () => {
    const backing = createEtherfuseAdapter({
      mode: 'mock',
      mockOptions: { latencyMs: [0, 0], settlementMs: 40 },
    });
    const quote = await backing.getQuote({
      sellAsset: TESOURO,
      buyAsset: BRL,
      sellAmount: '100',
      account: ACCOUNT,
    });
    const created = await backing.createOrder({ quoteId: quote.id, account: ACCOUNT });

    const inner = (backing as unknown as { api: import('../api/api').EtherfuseApi }).api;
    const routeless = createEtherfuseAdapter({
      mode: 'mock',
      api: {
        ...inner,
        mode: inner.mode,
        simulateCryptoReceived: async () => {
          const { RampError } = await import('@brk/ramp-core');
          throw new RampError({
            code: 'INVALID_REQUEST',
            anchorId: 'etherfuse',
            message: 'Etherfuse POST /ramp/order/crypto_received returned 404',
            status: 404,
          });
        },
        getOrder: (id) => inner.getOrder(id),
      },
    });

    const resolved = await routeless.simulateCryptoReceived(created.id);
    expect(resolved.id).toBe(created.id);
    expect(resolved.status).toBe('awaiting_signature');
  });
});

describe('a wallet the anchor has never seen', () => {
  /**
   * Etherfuse authorises wallets per customer, not per API key. A visitor who
   * is not the operator gets `400 Wallet not found or not authorized` on
   * `POST /ramp/order` — the quote succeeds, because a price does not depend on
   * who receives it, so the failure lands at the last step of the flow.
   *
   * Confirmed against the live sandbox: posting the visitor's public key to
   * `/ramp/onboarding-url` registers it, and the identical order then returns
   * 200. Without this the app only ever works for whoever ran the setup script.
   */
  const STRANGER = 'GA5UUGFVQDOJLXZX4QH3MRX5I2M5M2CX4CUHV7XQXJX3A2EEFGSBMT3N';

  /** A mock API that refuses orders until the wallet has been registered. */
  function strictAnchor(inner: import('../api/api').EtherfuseApi) {
    const registered = new Set<string>();
    const orderAttempts: string[] = [];

    return {
      registered,
      orderAttempts,
      api: {
        ...inner,
        mode: inner.mode,
        createOnboardingUrl: async (req: import('../api/api').EtherfuseOnboardingRequest) => {
          registered.add(req.publicKey);
          return { presigned_url: 'https://sandbox.etherfuse.com/ramp/onboarding' };
        },
        createOrder: async (req: import('../api/api').EtherfuseOrderRequest) => {
          orderAttempts.push(req.publicKey);
          if (!registered.has(req.publicKey)) {
            const { RampError } = await import('@brk/ramp-core');
            throw new RampError({
              code: 'INVALID_REQUEST',
              anchorId: 'etherfuse',
              message: 'Wallet not found or not authorized',
              status: 400,
            });
          }
          return inner.createOrder(req);
        },
      } as import('../api/api').EtherfuseApi,
    };
  }

  it('registers the wallet and retries the order once', async () => {
    const backing = adapter();
    const quote = await backing.getQuote({
      sellAsset: BRL,
      buyAsset: TESOURO,
      sellAmount: '500',
      account: STRANGER,
    });

    const inner = (backing as unknown as { api: import('../api/api').EtherfuseApi }).api;
    const anchor = strictAnchor(inner);
    const a = createEtherfuseAdapter({
      mode: 'mock',
      customerId: 'cus_test',
      bankAccountId: 'bank_test',
      api: anchor.api,
    });

    const order = await a.createOrder({ quoteId: quote.id, account: STRANGER });

    expect(order.id).toBeTruthy();
    expect(anchor.registered.has(STRANGER)).toBe(true);
    // Exactly one retry — the first refusal, then the authorised attempt.
    expect(anchor.orderAttempts).toEqual([STRANGER, STRANGER]);
  });

  it('does not retry, or register anything, for an unrelated failure', async () => {
    const backing = adapter();
    const quote = await backing.getQuote({
      sellAsset: BRL,
      buyAsset: TESOURO,
      sellAmount: '500',
      account: STRANGER,
    });

    const inner = (backing as unknown as { api: import('../api/api').EtherfuseApi }).api;
    const registered: string[] = [];
    let attempts = 0;

    const a = createEtherfuseAdapter({
      mode: 'mock',
      customerId: 'cus_test',
      bankAccountId: 'bank_test',
      api: {
        ...inner,
        mode: inner.mode,
        createOnboardingUrl: async (req: import('../api/api').EtherfuseOnboardingRequest) => {
          registered.push(req.publicKey);
          return { presigned_url: 'https://example.com' };
        },
        createOrder: async () => {
          attempts += 1;
          const { RampError } = await import('@brk/ramp-core');
          throw new RampError({
            code: 'INVALID_ORDER_STATE',
            anchorId: 'etherfuse',
            message: 'A pending onramp order already exists for this bank account and amount',
            status: 409,
          });
        },
      } as import('../api/api').EtherfuseApi,
    });

    await expect(a.createOrder({ quoteId: quote.id, account: STRANGER })).rejects.toThrow(
      /pending onramp order/i,
    );
    expect(attempts).toBe(1);
    expect(registered).toEqual([]);
  });

  it('surfaces the anchor’s original refusal when registering fails', async () => {
    const backing = adapter();
    const quote = await backing.getQuote({
      sellAsset: BRL,
      buyAsset: TESOURO,
      sellAmount: '500',
      account: STRANGER,
    });

    const inner = (backing as unknown as { api: import('../api/api').EtherfuseApi }).api;
    const a = createEtherfuseAdapter({
      mode: 'mock',
      customerId: 'cus_test',
      bankAccountId: 'bank_test',
      api: {
        ...inner,
        mode: inner.mode,
        createOnboardingUrl: async () => {
          throw new Error('onboarding is down');
        },
        createOrder: async () => {
          const { RampError } = await import('@brk/ramp-core');
          throw new RampError({
            code: 'INVALID_REQUEST',
            anchorId: 'etherfuse',
            message: 'Wallet not found or not authorized',
            status: 400,
          });
        },
      } as import('../api/api').EtherfuseApi,
    });

    // The refusal is the actionable fact; a failure to auto-register is not
    // something the person staring at the screen can do anything about.
    await expect(a.createOrder({ quoteId: quote.id, account: STRANGER })).rejects.toThrow(
      /not authorized/i,
    );
  });
});
