/**
 * A production-shaped adapter for an anchor you cannot yet call.
 *
 * Manteca and Koywe both require commercial onboarding — no self-service
 * sandbox, no key you can get on a weekend. Two honest options exist: leave
 * them out of the router entirely, or model them as adapters that implement the
 * real interface and are loudly labelled as simulated. We take the second,
 * because the point of the router is that adding an anchor is one adapter — and
 * showing that costs nothing but honesty about which quotes are real.
 *
 * Nothing here pretends to be live: `mode` is hard-wired to `mock`, every quote
 * carries the flag, and the UI renders an amber badge for it.
 */

import {
  RampError,
  applyBps,
  fiat,
  multiply,
  stellarAsset,
  subtract,
  USDC_ISSUER_TESTNET,
  type AdapterCapabilities,
  type AssetId,
  type CountryCode,
  type CreateOrderRequest,
  type Order,
  type Quote,
  type QuoteRequest,
  type RampAdapter,
  type RampDirection,
  type SupportedCorridor,
} from '@brk/ramp-core';

export interface MockCorridorFixture {
  direction: RampDirection;
  fiat: string;
  asset: string;
  country: CountryCode;
  rail: string;
  rate: string;
  feeBps: number;
  min: string;
  max: string;
}

export interface MockAnchorFixture {
  name: string;
  docsUrl?: string;
  countries: CountryCode[];
  note: string;
  latencyMs: [number, number];
  quoteTtlSeconds: number;
  corridors: MockCorridorFixture[];
}

/** Only USDC is modelled on-chain here, which is all these corridors need. */
function assetIdFor(code: string): AssetId {
  if (code === 'USDC') return stellarAsset('USDC', USDC_ISSUER_TESTNET);
  throw new RampError({
    code: 'UNSUPPORTED_PAIR',
    message: `Mock adapters only model USDC on-chain; got "${code}".`,
  });
}

function toCorridor(c: MockCorridorFixture): SupportedCorridor {
  const fiatAsset = fiat(c.fiat);
  const onChain = assetIdFor(c.asset);
  return c.direction === 'onramp'
    ? {
        direction: 'onramp',
        sellAsset: fiatAsset,
        buyAsset: onChain,
        country: c.country,
        rail: c.rail,
        min: c.min,
        max: c.max,
      }
    : {
        direction: 'offramp',
        sellAsset: onChain,
        buyAsset: fiatAsset,
        country: c.country,
        rail: c.rail,
        min: c.min,
        max: c.max,
      };
}

interface StoredOrder {
  order: Order;
  settledAtMs?: number;
}

const STORE_KEY = Symbol.for('brk.mocks.orders');
const scope = globalThis as unknown as Record<symbol, Map<string, StoredOrder> | undefined>;

function orders(): Map<string, StoredOrder> {
  return (scope[STORE_KEY] ??= new Map());
}

/** Deterministic wobble from the request, so quotes move without Math.random. */
function jitter(seed: string, bps: number): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 33 + seed.charCodeAt(i)) | 0;
  return (1 + ((Math.abs(hash) % (bps * 2 + 1)) - bps) / 10_000).toFixed(7);
}

export interface MockAdapterOptions {
  /** Skip the simulated network latency — used by tests. */
  instant?: boolean;
  settlementMs?: number;
}

export class MockAnchorAdapter implements RampAdapter {
  readonly id: string;
  private readonly fixture: MockAnchorFixture;
  private readonly corridors: SupportedCorridor[];
  private readonly options: MockAdapterOptions;

  constructor(id: string, fixture: MockAnchorFixture, options: MockAdapterOptions = {}) {
    this.id = id;
    this.fixture = fixture;
    this.corridors = fixture.corridors.map(toCorridor);
    this.options = options;
  }

  capabilities(): AdapterCapabilities {
    return {
      id: this.id,
      name: this.fixture.name,
      mode: 'mock',
      countries: this.fixture.countries,
      corridors: this.corridors,
      features: {
        firmQuotes: false,
        orders: true,
        sandboxSimulation: true,
        interactive: false,
      },
      note: this.fixture.note,
      docsUrl: this.fixture.docsUrl,
    };
  }

  private async delay(): Promise<void> {
    if (this.options.instant) return;
    const [min, max] = this.fixture.latencyMs;
    await new Promise((r) => setTimeout(r, min + Math.floor(Math.random() * (max - min + 1))));
  }

  private find(req: QuoteRequest): MockCorridorFixture {
    const match = this.fixture.corridors.find((c) => {
      const corridor = toCorridor(c);
      return corridor.sellAsset === req.sellAsset && corridor.buyAsset === req.buyAsset;
    });

    if (!match) {
      throw new RampError({
        code: 'UNSUPPORTED_PAIR',
        anchorId: this.id,
        message: `${this.fixture.name} does not serve this corridor.`,
      });
    }
    return match;
  }

  async getQuote(req: QuoteRequest): Promise<Quote> {
    const startedAt = Date.now();
    await this.delay();

    const corridor = this.find(req);
    const sellAmount = req.sellAmount;

    if (!sellAmount) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: this.id,
        message: `${this.fixture.name} quotes from the sell side — provide sellAmount.`,
      });
    }
    if (Number(sellAmount) < Number(corridor.min) || Number(sellAmount) > Number(corridor.max)) {
      throw new RampError({
        code: 'AMOUNT_OUT_OF_RANGE',
        anchorId: this.id,
        message: `${this.fixture.name} accepts ${corridor.min}–${corridor.max} for this corridor.`,
      });
    }

    const id = `${this.id}-${startedAt}-${sellAmount}`;
    const rate = multiply(corridor.rate, jitter(id, 25));
    const fee = applyBps(sellAmount, corridor.feeBps);
    const buyAmount = multiply(subtract(sellAmount, fee), rate);

    return {
      id,
      anchorId: this.id,
      anchorName: this.fixture.name,
      mode: 'mock',
      direction: corridor.direction,
      sellAsset: req.sellAsset,
      buyAsset: req.buyAsset,
      sellAmount,
      buyAmount,
      price: rate,
      fee: { amount: fee, asset: req.sellAsset },
      expiresAt: new Date(startedAt + this.fixture.quoteTtlSeconds * 1000).toISOString(),
      latencyMs: Date.now() - startedAt,
      firmness: 'indicative',
      raw: { simulated: true, corridor },
    };
  }

  async createOrder(req: CreateOrderRequest): Promise<Order> {
    await this.delay();

    // Quote ids encode the corridor, so an order can be rebuilt without state.
    const parts = req.quoteId.split('-');
    const amount = parts[parts.length - 1] ?? '0';
    const corridor = this.fixture.corridors[0];
    if (!corridor) {
      throw new RampError({
        code: 'UNSUPPORTED_PAIR',
        anchorId: this.id,
        message: `${this.fixture.name} has no corridors configured.`,
      });
    }

    const mapped = toCorridor(corridor);
    const nowIso = new Date().toISOString();
    const order: Order = {
      id: req.orderId ?? `${this.id}-order-${Date.now()}`,
      anchorId: this.id,
      anchorName: this.fixture.name,
      mode: 'mock',
      direction: corridor.direction,
      status: corridor.direction === 'onramp' ? 'awaiting_payment' : 'awaiting_signature',
      quoteId: req.quoteId,
      sellAsset: mapped.sellAsset,
      buyAsset: mapped.buyAsset,
      sellAmount: amount,
      buyAmount: multiply(subtract(amount, applyBps(amount, corridor.feeBps)), corridor.rate),
      createdAt: nowIso,
      updatedAt: nowIso,
      history: [{ status: 'created', at: nowIso }],
      raw: { simulated: true },
    };

    orders().set(order.id, { order });
    return order;
  }

  async getOrder(orderId: string): Promise<Order> {
    await this.delay();
    const stored = orders().get(orderId);
    if (!stored) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: this.id,
        message: `Unknown order ${orderId}.`,
      });
    }

    if (stored.settledAtMs !== undefined) {
      const elapsed = Date.now() - stored.settledAtMs;
      const settlement = this.options.settlementMs ?? 3_500;
      const next = elapsed >= settlement ? 'completed' : 'processing';
      if (next !== stored.order.status) {
        stored.order.status = next;
        stored.order.updatedAt = new Date().toISOString();
        stored.order.history.push({ status: next, at: stored.order.updatedAt });
      }
    }
    return stored.order;
  }

  simulateFiatReceived(orderId: string): Promise<Order> {
    return this.settle(orderId);
  }

  simulateCryptoReceived(orderId: string): Promise<Order> {
    return this.settle(orderId);
  }

  private async settle(orderId: string): Promise<Order> {
    await this.delay();
    const stored = orders().get(orderId);
    if (!stored) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: this.id,
        message: `Unknown order ${orderId}.`,
      });
    }
    stored.settledAtMs = Date.now();
    stored.order.status = 'processing';
    stored.order.updatedAt = new Date().toISOString();
    stored.order.history.push({ status: 'processing', at: stored.order.updatedAt });
    return stored.order;
  }
}
