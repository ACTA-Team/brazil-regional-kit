/**
 * Etherfuse ⇄ ramp-core translation.
 *
 * Etherfuse speaks its own dialect: assets are `BRL` and `TESOURO:GC3C…`,
 * statuses are SHOUTING_SNAKE_CASE, and everything hangs off `sourceAmount`.
 * This file is the only place in the kit that knows any of that. Above it,
 * a quote from Etherfuse and a quote from a SEP-38 anchor are the same shape
 * and the router can rank them against each other.
 */

import {
  RampError,
  TESOURO,
  BRL,
  isFiat,
  isNative,
  parseAsset,
  divide,
  toRampError,
  type AdapterCapabilities,
  type AdapterMode,
  type AssetId,
  type CreateOrderRequest,
  type Order,
  type OrderStatus,
  type Quote,
  type QuoteRequest,
  type RampAdapter,
  type RampDirection,
} from '@brk/ramp-core';
import type { EtherfuseApi, EtherfuseOrderResponse, EtherfuseQuoteResponse } from './api';
import { EtherfuseHttpClient, ETHERFUSE_SANDBOX_URL } from './client';
import { EtherfuseMockClient, type EtherfuseMockOptions } from './mock';

export const ETHERFUSE_ID = 'etherfuse';
export const ETHERFUSE_NAME = 'Etherfuse';

// ── Asset translation ─────────────────────────────────────────────────────────

/** `iso4217:BRL` → `BRL`; `stellar:TESOURO:GC3C…` → `TESOURO:GC3C…`. */
export function toEtherfuseAsset(id: AssetId): string {
  if (isFiat(id)) return parseAsset(id).code;
  if (isNative(id)) return 'XLM';
  const { code, issuer } = parseAsset(id);
  return `${code}:${issuer}`;
}

// ── Status translation ────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, OrderStatus> = {
  CREATED: 'created',
  NEW: 'created',
  PENDING: 'awaiting_payment',
  PENDING_PAYMENT: 'awaiting_payment',
  AWAITING_PAYMENT: 'awaiting_payment',
  WAITING_PAYMENT: 'awaiting_payment',
  AWAITING_CRYPTO: 'awaiting_signature',
  PENDING_CRYPTO: 'awaiting_signature',
  AWAITING_DEPOSIT: 'awaiting_signature',
  AWAITING_SIGNATURE: 'awaiting_signature',
  PAYMENT_RECEIVED: 'processing',
  CRYPTO_RECEIVED: 'processing',
  PROCESSING: 'processing',
  IN_PROGRESS: 'processing',
  SETTLING: 'processing',
  COMPLETE: 'completed',
  COMPLETED: 'completed',
  SETTLED: 'completed',
  SUCCESS: 'completed',
  DONE: 'completed',
  FAILED: 'failed',
  ERROR: 'failed',
  REJECTED: 'failed',
  CANCELLED: 'failed',
  CANCELED: 'failed',
  EXPIRED: 'expired',
  TIMEOUT: 'expired',
};

/**
 * Unknown statuses map to `processing`, not `failed`. An anchor inventing a new
 * intermediate state should stall the UI at worst — never tell a user their
 * money failed when it is merely somewhere we have not seen before.
 */
export function mapStatus(raw: string): OrderStatus {
  return STATUS_MAP[raw?.toUpperCase?.() ?? ''] ?? 'processing';
}

// ── Configuration ─────────────────────────────────────────────────────────────

export interface EtherfuseAdapterConfig {
  mode: AdapterMode;
  apiKey?: string;
  baseUrl?: string;
  /**
   * Created once per user by `pnpm setup:etherfuse` and reused forever.
   * Regenerating them on every session orphans in-flight orders.
   */
  customerId?: string;
  bankAccountId?: string;
  /** Inject a client directly (tests, fixture recording). */
  api?: EtherfuseApi;
  mockOptions?: EtherfuseMockOptions;
  /** Overridden after `GET /ramp/assets` confirms what the sandbox serves. */
  corridors?: AdapterCapabilities['corridors'];
}

const DEFAULT_CORRIDORS: AdapterCapabilities['corridors'] = [
  {
    direction: 'onramp',
    sellAsset: BRL,
    buyAsset: TESOURO,
    country: 'BR',
    rail: 'PIX',
    min: '10',
    max: '20000',
  },
  {
    direction: 'offramp',
    sellAsset: TESOURO,
    buyAsset: BRL,
    country: 'BR',
    rail: 'PIX',
    min: '10',
    max: '20000',
  },
];

// ── Adapter ───────────────────────────────────────────────────────────────────

export class EtherfuseAdapter implements RampAdapter {
  private readonly api: EtherfuseApi;
  private readonly config: EtherfuseAdapterConfig;
  /** Remembers each order's corridor, so `getOrder` can rebuild a full Order. */
  private readonly context = new Map<string, { req: QuoteRequest; direction: RampDirection }>();

  constructor(config: EtherfuseAdapterConfig) {
    this.config = config;
    this.api =
      config.api ??
      (config.mode === 'live'
        ? new EtherfuseHttpClient({
            apiKey: config.apiKey ?? '',
            baseUrl: config.baseUrl ?? ETHERFUSE_SANDBOX_URL,
          })
        : new EtherfuseMockClient(config.mockOptions));
  }

  capabilities(): AdapterCapabilities {
    const mode = this.api.mode;
    return {
      id: ETHERFUSE_ID,
      name: ETHERFUSE_NAME,
      mode,
      countries: ['BR', 'MX'],
      corridors: this.config.corridors ?? DEFAULT_CORRIDORS,
      features: {
        firmQuotes: true,
        orders: true,
        sandboxSimulation: true,
        interactive: true,
      },
      note:
        mode === 'live'
          ? 'Live Etherfuse sandbox: real quotes, real orders, real on-chain settlement.'
          : 'Replaying recorded Etherfuse sandbox fixtures — no call leaves this machine.',
      docsUrl: 'https://devnet.etherfuse.com/ramp',
    };
  }

  private directionFor(req: QuoteRequest): RampDirection {
    if (isFiat(req.sellAsset)) return 'onramp';
    if (isFiat(req.buyAsset)) return 'offramp';
    throw new RampError({
      code: 'UNSUPPORTED_PAIR',
      anchorId: ETHERFUSE_ID,
      message: 'Etherfuse ramps between fiat and an on-chain asset; one side must be fiat.',
    });
  }

  async getQuote(req: QuoteRequest): Promise<Quote> {
    const startedAt = Date.now();
    const direction = this.directionFor(req);

    if (!req.sellAmount) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: ETHERFUSE_ID,
        message: 'Etherfuse quotes from the sell side — provide sellAmount.',
      });
    }

    const quoteId = crypto.randomUUID();
    let raw: EtherfuseQuoteResponse;
    try {
      raw = await this.api.quote({
        quoteId,
        customerId: req.customerId ?? this.config.customerId ?? '',
        blockchain: 'stellar',
        walletAddress: req.account ?? '',
        quoteAssets: {
          type: direction,
          sourceAsset: toEtherfuseAsset(req.sellAsset),
          targetAsset: toEtherfuseAsset(req.buyAsset),
        },
        sourceAmount: req.sellAmount,
      });
    } catch (e) {
      throw toRampError(e, ETHERFUSE_ID);
    }

    this.context.set(quoteId, { req, direction });

    const sellAmount = raw.sourceAmount ?? req.sellAmount;
    const buyAmount = raw.targetAmount ?? '0';

    return {
      id: raw.quoteId ?? quoteId,
      anchorId: ETHERFUSE_ID,
      anchorName: ETHERFUSE_NAME,
      mode: this.api.mode,
      direction,
      sellAsset: req.sellAsset,
      buyAsset: req.buyAsset,
      sellAmount,
      buyAmount,
      price: raw.rate ?? safeDivide(buyAmount, sellAmount),
      fee: {
        amount: raw.fee ?? '0',
        asset: req.sellAsset,
      },
      // Etherfuse quotes are short-lived; when they omit an expiry we assume the
      // shortest plausible window rather than the longest.
      expiresAt: raw.expiresAt ?? new Date(startedAt + 30_000).toISOString(),
      latencyMs: Date.now() - startedAt,
      firmness: 'firm',
      raw,
    };
  }

  async createOrder(req: CreateOrderRequest): Promise<Order> {
    const ctx = this.context.get(req.quoteId);
    const orderId = req.orderId ?? crypto.randomUUID();

    let raw: EtherfuseOrderResponse;
    try {
      raw = await this.api.createOrder({
        orderId,
        bankAccountId: req.bankAccountId ?? this.config.bankAccountId ?? '',
        publicKey: assertClassicAddress(req.account),
        quoteId: req.quoteId,
      });
    } catch (e) {
      throw toRampError(e, ETHERFUSE_ID);
    }

    if (ctx) this.context.set(raw.orderId ?? orderId, ctx);
    return this.toOrder(raw, ctx?.req, ctx?.direction);
  }

  async getOrder(orderId: string): Promise<Order> {
    const ctx = this.context.get(orderId);
    try {
      const raw = await this.api.getOrder(orderId);
      return this.toOrder(raw, ctx?.req, ctx?.direction);
    } catch (e) {
      throw toRampError(e, ETHERFUSE_ID);
    }
  }

  async regenerateTx(orderId: string): Promise<Order> {
    const ctx = this.context.get(orderId);
    try {
      const raw = await this.api.regenerateTx(orderId);
      return this.toOrder(raw, ctx?.req, ctx?.direction);
    } catch (e) {
      throw toRampError(e, ETHERFUSE_ID);
    }
  }

  async simulateFiatReceived(orderId: string): Promise<Order> {
    const ctx = this.context.get(orderId);
    try {
      const raw = await this.api.simulateFiatReceived(orderId);
      return this.toOrder(raw, ctx?.req, ctx?.direction);
    } catch (e) {
      throw toRampError(e, ETHERFUSE_ID);
    }
  }

  async simulateCryptoReceived(orderId: string): Promise<Order> {
    const ctx = this.context.get(orderId);
    try {
      const raw = await this.api.simulateCryptoReceived(orderId);
      return this.toOrder(raw, ctx?.req, ctx?.direction);
    } catch (e) {
      throw toRampError(e, ETHERFUSE_ID);
    }
  }

  async getInteractiveUrl(req: QuoteRequest): Promise<string> {
    const customerId = req.customerId ?? this.config.customerId ?? crypto.randomUUID();
    const res = await this.api.createOnboardingUrl({ customerId });
    return res.url;
  }

  /** What the sandbox actually serves — the source of truth for MXN support. */
  listAssets() {
    return this.api.listAssets();
  }

  // ── Mapping ─────────────────────────────────────────────────────────────────

  private toOrder(
    raw: EtherfuseOrderResponse,
    req?: QuoteRequest,
    direction?: RampDirection,
  ): Order {
    const resolvedDirection: RampDirection =
      direction ?? (raw.burnTransaction || raw.anchorAccount ? 'offramp' : 'onramp');

    const pixCode = raw.pixCode ?? raw.paymentInstructions?.pixCode;
    const nowIso = new Date().toISOString();
    const status = mapStatus(raw.status);

    return {
      id: raw.orderId,
      anchorId: ETHERFUSE_ID,
      anchorName: ETHERFUSE_NAME,
      mode: this.api.mode,
      direction: resolvedDirection,
      status,
      quoteId: raw.quoteId,

      sellAsset: req?.sellAsset ?? (resolvedDirection === 'onramp' ? BRL : TESOURO),
      buyAsset: req?.buyAsset ?? (resolvedDirection === 'onramp' ? TESOURO : BRL),
      sellAmount: raw.sourceAmount ?? '0',
      buyAmount: raw.targetAmount ?? '0',

      paymentInstructions: pixCode
        ? {
            type: 'pix',
            code: pixCode,
            qrImage: raw.pixQrCode ?? raw.paymentInstructions?.qrCode,
            amount: raw.sourceAmount ?? '0',
            currency: 'BRL',
            expiresAt: raw.paymentInstructions?.expiresAt,
          }
        : undefined,

      unsignedTxXdr: raw.burnTransaction ?? raw.stellarClaimTransaction,
      txHash: raw.transactionHash,
      anchorAccount: typeof raw.anchorAccount === 'string' ? raw.anchorAccount : undefined,

      createdAt: raw.createdAt ?? nowIso,
      updatedAt: raw.updatedAt ?? nowIso,
      history: [{ status, at: raw.updatedAt ?? nowIso }],
      raw,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeDivide(a: string, b: string): string {
  try {
    return divide(a, b);
  } catch {
    return '0';
  }
}

/**
 * Etherfuse settles to classic accounts only. A passkey/smart wallet exposes a
 * `C…` contract address that looks like an address and is silently useless here,
 * so we reject it with an explanation rather than letting funds go nowhere.
 */
function assertClassicAddress(address: string): string {
  if (!address?.startsWith('G')) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      anchorId: ETHERFUSE_ID,
      message: address?.startsWith('C')
        ? 'Etherfuse needs a classic G… address. Passkey wallets expose a C… contract address — pass the underlying classic account instead.'
        : `"${address}" is not a Stellar account address.`,
    });
  }
  return address;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createEtherfuseAdapter(config: EtherfuseAdapterConfig): EtherfuseAdapter {
  return new EtherfuseAdapter(config);
}
