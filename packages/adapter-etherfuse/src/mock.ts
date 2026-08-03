/**
 * Fixture-backed Etherfuse simulator.
 *
 * This exists because the sandbox is documented as "rough around the edges" and
 * a demo must never be one flaky remote away from having nothing to show. It
 * implements the same `EtherfuseApi` the live client does, so the adapter above
 * it cannot tell the difference — and it models the parts that matter for a
 * believable demo: quotes that really expire, orders that sit in
 * `PENDING_PAYMENT` until the PIX is simulated, and settlement that takes a
 * couple of seconds instead of returning `COMPLETED` instantly.
 *
 * What it does NOT do is invent market data silently: every quote it produces is
 * tagged `mock` all the way to the UI badge.
 */

import { RampError, applyBps, multiply, subtract } from '@brk/ramp-core';
import type {
  EtherfuseApi,
  EtherfuseAsset,
  EtherfuseOnboardingRequest,
  EtherfuseOnboardingResponse,
  EtherfuseOrderRequest,
  EtherfuseOrderResponse,
  EtherfuseQuoteRequest,
  EtherfuseQuoteResponse,
} from './api';
import { buildPixPayload } from './pix';
import ratesFixture from '../fixtures/rates.json';
import assetsFixture from '../fixtures/assets.json';

interface PairFixture {
  rate: string;
  feeBps: number;
}

const PAIRS = ratesFixture.pairs as Record<string, PairFixture>;
const LIMITS = ratesFixture.limits as Record<string, { min: string; max: string }>;

/** `TESOURO:GC3C…` → `TESOURO`. Fiat codes pass through untouched. */
function symbolOf(asset: string): string {
  return (asset.split(':')[0] ?? asset).toUpperCase();
}

const pairKey = (source: string, target: string) => `${symbolOf(source)}>${symbolOf(target)}`;

interface StoredQuote {
  request: EtherfuseQuoteRequest;
  response: EtherfuseQuoteResponse;
  expiresAtMs: number;
}

interface StoredOrder {
  order: EtherfuseOrderResponse;
  direction: 'onramp' | 'offramp';
  /** When the fiat/crypto leg was simulated — drives time-based settlement. */
  settledAtMs?: number;
}

/**
 * Survives Next.js hot reloads. Without this, editing a component mid-demo
 * would silently drop every in-flight order.
 */
interface MockStore {
  quotes: Map<string, StoredQuote>;
  orders: Map<string, StoredOrder>;
}

const STORE_KEY = Symbol.for('brk.etherfuse.mock.store');
const globalScope = globalThis as unknown as Record<symbol, MockStore | undefined>;

function store(): MockStore {
  const existing = globalScope[STORE_KEY];
  if (existing) return existing;
  const created: MockStore = { quotes: new Map(), orders: new Map() };
  globalScope[STORE_KEY] = created;
  return created;
}

export interface EtherfuseMockOptions {
  /** Simulated round-trip latency, so the UI's loading states are exercised. */
  latencyMs?: [min: number, max: number];
  /** Rate wobble, in basis points, so consecutive quotes are not identical. */
  jitterBps?: number;
  /** How long settlement takes after the fiat/crypto leg is simulated. */
  settlementMs?: number;
  now?: () => number;
}

/** Deterministic-ish wobble derived from the quote id — no Math.random needed. */
function jitterFactor(seed: string, bps: number): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const swing = ((Math.abs(hash) % (bps * 2 + 1)) - bps) / 10_000;
  return (1 + swing).toFixed(7);
}

export class EtherfuseMockClient implements EtherfuseApi {
  readonly mode = 'mock' as const;

  private readonly latency: [number, number];
  private readonly jitterBps: number;
  private readonly settlementMs: number;
  private readonly now: () => number;

  constructor(opts: EtherfuseMockOptions = {}) {
    this.latency = opts.latencyMs ?? [120, 340];
    this.jitterBps = opts.jitterBps ?? 30;
    this.settlementMs = opts.settlementMs ?? 4_000;
    this.now = opts.now ?? (() => Date.now());
  }

  private async delay(): Promise<void> {
    const [min, max] = this.latency;
    const span = Math.max(0, max - min);
    await new Promise((r) => setTimeout(r, min + Math.floor(Math.random() * (span + 1))));
  }

  async createOnboardingUrl(req: EtherfuseOnboardingRequest): Promise<EtherfuseOnboardingResponse> {
    await this.delay();
    return {
      url: `https://devnet.etherfuse.com/ramp?mock=1&customerId=${encodeURIComponent(req.customerId)}`,
      customerId: req.customerId,
      bankAccountId: `mock-bank-${req.customerId.slice(0, 8)}`,
    };
  }

  async quote(req: EtherfuseQuoteRequest): Promise<EtherfuseQuoteResponse> {
    await this.delay();

    const key = pairKey(req.quoteAssets.sourceAsset, req.quoteAssets.targetAsset);
    const pair = PAIRS[key];
    if (!pair) {
      throw new RampError({
        code: 'UNSUPPORTED_PAIR',
        anchorId: 'etherfuse',
        message: `Etherfuse does not ramp ${key.replace('>', ' → ')}.`,
      });
    }

    const sourceSymbol = symbolOf(req.quoteAssets.sourceAsset);
    const limit = LIMITS[sourceSymbol];
    if (limit && Number(req.sourceAmount) < Number(limit.min)) {
      throw new RampError({
        code: 'AMOUNT_OUT_OF_RANGE',
        anchorId: 'etherfuse',
        message: `Minimum for ${sourceSymbol} is ${limit.min}.`,
      });
    }
    if (limit && Number(req.sourceAmount) > Number(limit.max)) {
      throw new RampError({
        code: 'AMOUNT_OUT_OF_RANGE',
        anchorId: 'etherfuse',
        message: `Maximum for ${sourceSymbol} is ${limit.max}.`,
      });
    }

    const rate = multiply(pair.rate, jitterFactor(req.quoteId, this.jitterBps));
    const fee = applyBps(req.sourceAmount, pair.feeBps);
    const targetAmount = multiply(subtract(req.sourceAmount, fee), rate);

    const ttlMs = ratesFixture.quoteTtlSeconds * 1000;
    const expiresAtMs = this.now() + ttlMs;

    const response: EtherfuseQuoteResponse = {
      quoteId: req.quoteId,
      sourceAmount: req.sourceAmount,
      targetAmount,
      rate,
      fee,
      feeCurrency: sourceSymbol,
      expiresAt: new Date(expiresAtMs).toISOString(),
      _mock: true,
    };

    store().quotes.set(req.quoteId, { request: req, response, expiresAtMs });
    return response;
  }

  async createOrder(req: EtherfuseOrderRequest): Promise<EtherfuseOrderResponse> {
    await this.delay();

    const held = store().quotes.get(req.quoteId);
    if (!held) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: 'etherfuse',
        message: `Unknown quote ${req.quoteId}.`,
      });
    }
    if (this.now() > held.expiresAtMs) {
      throw new RampError({
        code: 'QUOTE_EXPIRED',
        anchorId: 'etherfuse',
        message: 'Quote expired before the order was created — request a new one.',
      });
    }

    const direction = held.request.quoteAssets.type;
    const nowIso = new Date(this.now()).toISOString();

    const order: EtherfuseOrderResponse = {
      orderId: req.orderId,
      quoteId: req.quoteId,
      status: direction === 'onramp' ? 'PENDING_PAYMENT' : 'AWAITING_CRYPTO',
      sourceAmount: held.response.sourceAmount,
      targetAmount: held.response.targetAmount,
      createdAt: nowIso,
      updatedAt: nowIso,
      _mock: true,
    };

    if (direction === 'onramp') {
      order.pixCode = buildPixPayload({
        key: ratesFixture.pix.key,
        amount: held.response.sourceAmount,
        merchantName: ratesFixture.pix.merchantName,
        merchantCity: ratesFixture.pix.merchantCity,
        txid: req.orderId.replace(/-/g, '').slice(0, 20).toUpperCase(),
        description: 'BRK sandbox on-ramp',
      });
      order.paymentInstructions = {
        pixCode: order.pixCode,
        expiresAt: held.response.expiresAt,
      };
    } else {
      // No pre-built burn XDR: the kit builds a real, signable return payment
      // against the live network instead, so even mock mode settles on-chain.
      order.anchorAccount = ratesFixture.anchorAccount;
    }

    store().orders.set(req.orderId, { order, direction });
    return order;
  }

  async getOrder(orderId: string): Promise<EtherfuseOrderResponse> {
    await this.delay();
    const stored = store().orders.get(orderId);
    if (!stored) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: 'etherfuse',
        message: `Unknown order ${orderId}.`,
      });
    }
    return this.advance(stored);
  }

  /** Settlement is time-based, so the stepper animates instead of teleporting. */
  private advance(stored: StoredOrder): EtherfuseOrderResponse {
    if (stored.settledAtMs === undefined) return stored.order;

    const elapsed = this.now() - stored.settledAtMs;
    const next =
      elapsed >= this.settlementMs
        ? 'COMPLETED'
        : elapsed >= this.settlementMs / 2
          ? 'PROCESSING'
          : stored.order.status;

    if (next !== stored.order.status) {
      stored.order.status = next;
      stored.order.updatedAt = new Date(this.now()).toISOString();
    }
    return stored.order;
  }

  async regenerateTx(orderId: string): Promise<EtherfuseOrderResponse> {
    await this.delay();
    const stored = store().orders.get(orderId);
    if (!stored) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: 'etherfuse',
        message: `Unknown order ${orderId}.`,
      });
    }
    stored.order.updatedAt = new Date(this.now()).toISOString();
    return stored.order;
  }

  async listAssets(): Promise<EtherfuseAsset[]> {
    await this.delay();
    return assetsFixture.assets as EtherfuseAsset[];
  }

  simulateFiatReceived(orderId: string): Promise<EtherfuseOrderResponse> {
    return this.settle(orderId, 'onramp', 'PAYMENT_RECEIVED');
  }

  simulateCryptoReceived(orderId: string): Promise<EtherfuseOrderResponse> {
    return this.settle(orderId, 'offramp', 'CRYPTO_RECEIVED');
  }

  private async settle(
    orderId: string,
    expected: 'onramp' | 'offramp',
    status: string,
  ): Promise<EtherfuseOrderResponse> {
    await this.delay();
    const stored = store().orders.get(orderId);
    if (!stored) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: 'etherfuse',
        message: `Unknown order ${orderId}.`,
      });
    }
    if (stored.direction !== expected) {
      throw new RampError({
        code: 'INVALID_ORDER_STATE',
        anchorId: 'etherfuse',
        message: `Order ${orderId} is an ${stored.direction}; cannot settle it as an ${expected}.`,
      });
    }
    stored.order.status = status;
    stored.order.updatedAt = new Date(this.now()).toISOString();
    stored.settledAtMs = this.now();
    return stored.order;
  }
}

/** Wipe in-memory state — used by the demo's "start over" control and by tests. */
export function resetEtherfuseMock(): void {
  const s = store();
  s.quotes.clear();
  s.orders.clear();
}
