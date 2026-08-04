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
  TESOURO_ISSUER_TESTNET,
  BRL,
  MXN,
  USDC,
  stellarAsset,
  applyBps,
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

/**
 * Etherfuse rejects a quote whose `walletAddress` is not a valid Stellar
 * account — including an empty one. But a price is a price: it does not depend
 * on who is asking, and comparing anchors before connecting a wallet is a
 * perfectly reasonable thing for a user to do.
 *
 * So when no account is supplied we quote against a well-known address purely
 * to satisfy the validator. Orders are a different matter and still demand the
 * customer's real account — `createOrder` never substitutes anything.
 */
const QUOTE_PROBE_ACCOUNT = TESOURO_ISSUER_TESTNET;

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
 *
 * `CREATED` needs the direction to be useful. Etherfuse leaves a live order in
 * `created` until the money moves, but from the customer's side that is not a
 * neutral waiting room: on an on-ramp they owe a PIX payment, on an off-ramp
 * they owe a signature. Reporting it as a bare `created` leaves the UI showing
 * step one with nothing to click, which reads as a hung integration.
 */
export function mapStatus(raw: string, direction?: RampDirection): OrderStatus {
  const mapped = STATUS_MAP[raw?.toUpperCase?.() ?? ''] ?? 'processing';

  if (mapped === 'created' && direction) {
    return direction === 'onramp' ? 'awaiting_payment' : 'awaiting_signature';
  }
  return mapped;
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
  /** Shown to the customer inside the anchor's KYC flow. */
  userEmail?: string;
  userDisplayName?: string;
  /** Overridden after `GET /ramp/assets` confirms what the sandbox serves. */
  corridors?: AdapterCapabilities['corridors'];
}

/**
 * Etherfuse issues every stablebond from one account, so the Mexican assets
 * share TESOURO's issuer. All of these were confirmed against the live sandbox.
 */
export const MEXE = stellarAsset('MEXe', TESOURO_ISSUER_TESTNET);
export const CETES = stellarAsset('CETES', TESOURO_ISSUER_TESTNET);

/**
 * Etherfuse ramps straight to USDC — same Circle issuer this kit pins
 * everywhere else. That matters more than it looks: it means BRL reaches the
 * asset a remittance actually travels in without a DEX hop, and the corridor is
 * one anchor end to end rather than anchor → order book → anchor.
 *
 * The DEX swap in `stablecoin-kit` is still there and still real; it is now the
 * fallback for pairs no anchor serves, rather than a required leg.
 */
const ETHERFUSE_USDC = USDC;

/**
 * One side is always fiat. The sandbox rejects an on-chain-to-on-chain quote
 * outright — `expected MXN or BRL` — because this is a ramp, not an exchange.
 *
 * Sandbox on-ramps from MXN are capped at 500; over that it returns
 * `SandboxAmountExceeded`.
 */
const DEFAULT_CORRIDORS: AdapterCapabilities['corridors'] = [
  // Brazil · PIX
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
  {
    direction: 'onramp',
    sellAsset: BRL,
    buyAsset: ETHERFUSE_USDC,
    country: 'BR',
    rail: 'PIX',
    min: '10',
    max: '20000',
  },
  {
    direction: 'offramp',
    sellAsset: ETHERFUSE_USDC,
    buyAsset: BRL,
    country: 'BR',
    rail: 'PIX',
    min: '2',
    max: '5000',
  },

  // Mexico · SPEI
  {
    direction: 'onramp',
    sellAsset: MXN,
    buyAsset: MEXE,
    country: 'MX',
    rail: 'SPEI',
    min: '50',
    max: '500',
  },
  {
    direction: 'offramp',
    sellAsset: MEXE,
    buyAsset: MXN,
    country: 'MX',
    rail: 'SPEI',
    min: '5',
    max: '500',
  },
  {
    direction: 'onramp',
    sellAsset: MXN,
    buyAsset: ETHERFUSE_USDC,
    country: 'MX',
    rail: 'SPEI',
    min: '50',
    max: '500',
  },
  {
    direction: 'offramp',
    sellAsset: ETHERFUSE_USDC,
    buyAsset: MXN,
    country: 'MX',
    rail: 'SPEI',
    min: '2',
    max: '5000',
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
        walletAddress: req.account?.startsWith('G') ? req.account : QUOTE_PROBE_ACCOUNT,
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

    /*
     * The server issues its own quote id and ignores the one we sent. Orders
     * that reference our id fail with an unknown quote, so the response's id is
     * the one that matters — and it is what we key the context off.
     */
    const resolvedId = raw.quoteId ?? quoteId;
    this.context.set(resolvedId, { req, direction });

    const sellAmount = raw.sourceAmount ?? req.sellAmount;
    const buyAmount = raw.destinationAmount ?? '0';

    return {
      id: resolvedId,
      anchorId: ETHERFUSE_ID,
      anchorName: ETHERFUSE_NAME,
      mode: this.api.mode,
      direction,
      sellAsset: req.sellAsset,
      buyAsset: req.buyAsset,
      sellAmount,
      buyAmount,
      // `exchangeRate` is post-fee, which is the rate a user actually gets.
      price: raw.exchangeRate ?? safeDivide(buyAmount, sellAmount),
      fee: {
        amount: raw.feeAmount ?? feeFromBps(sellAmount, raw.feeBps) ?? '0',
        asset: req.sellAsset,
      },
      // Sandbox quotes live about two minutes. When the anchor omits an expiry
      // we assume the shortest plausible window rather than the longest.
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

  /**
   * KYC onboarding. Etherfuse needs the bank account id up front — it is not
   * handed back afterwards — and returns the URL under `presigned_url`.
   */
  async getInteractiveUrl(req: QuoteRequest): Promise<string> {
    const res = await this.api.createOnboardingUrl({
      customerId: req.customerId ?? this.config.customerId ?? crypto.randomUUID(),
      bankAccountId: this.config.bankAccountId ?? crypto.randomUUID(),
      publicKey: assertClassicAddress(req.account ?? ''),
      blockchain: 'stellar',
      userInfo: {
        email: this.config.userEmail ?? 'sandbox@brazil-regional-kit.demo',
        displayName: this.config.userDisplayName ?? 'BRK Sandbox',
      },
    });

    const url = res.presigned_url ?? res.url;
    if (!url) {
      throw new RampError({
        code: 'ANCHOR_UNAVAILABLE',
        anchorId: ETHERFUSE_ID,
        message: 'Etherfuse returned no onboarding URL.',
        raw: res,
      });
    }
    return url;
  }

  /** What the sandbox actually serves for a currency, with per-wallet balances. */
  listAssets(currency: string, wallet: string) {
    return this.api.listAssets({ blockchain: 'stellar', currency, wallet });
  }

  // ── Mapping ─────────────────────────────────────────────────────────────────

  private toOrder(
    raw: EtherfuseOrderResponse,
    req?: QuoteRequest,
    direction?: RampDirection,
  ): Order {
    /*
     * `orderType` is on the fetched order but not the create response, so fall
     * back to what we remembered from the quote, then to the shape of the
     * payload itself.
     */
    const resolvedDirection: RampDirection =
      (raw.orderType === 'onramp' || raw.orderType === 'offramp' ? raw.orderType : undefined) ??
      direction ??
      (raw.burnTransaction || raw.anchorAccount ? 'offramp' : 'onramp');

    const nowIso = new Date().toISOString();
    // The create response omits `status` entirely; an order that exists but has
    // not been fetched yet is `created`, not "unknown".
    const status = mapStatus(raw.status ?? 'CREATED', resolvedDirection);

    // The same amount is `amountInFiat` when fetched and `depositAmount` when
    // created — and `sourceAmount` in the shape the docs describe.
    const fiatAmount = raw.amountInFiat ?? raw.depositAmount ?? raw.sourceAmount ?? '0';
    const pixCode = raw.pixCode ?? raw.paymentInstructions?.pixCode;

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
      sellAmount: resolvedDirection === 'onramp' ? fiatAmount : (raw.sourceAmount ?? fiatAmount),
      buyAmount: raw.destinationAmount ?? '0',

      paymentInstructions: pixCode
        ? {
            type: 'pix',
            code: pixCode,
            qrImage: raw.pixQrCode ?? raw.paymentInstructions?.qrCode,
            amount: fiatAmount,
            currency: 'BRL',
            expiresAt: raw.paymentInstructions?.expiresAt,
          }
        : /*
           * No PIX payload, but the anchor named an account to deposit into.
           * This is what a BRL order looks like when the customer only ever
           * onboarded a Mexican bank account: `depositBankName` comes back as
           * "STP" and there is nothing Brazilian to pay into.
           */
          raw.depositBankName
          ? {
              type: 'bank',
              rail: raw.depositBankName,
              reference: raw.depositClabe || undefined,
              accountLabel: raw.depositAccountHolder,
              amount: fiatAmount,
              currency: req?.sellAsset === BRL ? 'BRL' : 'MXN',
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

/** Some responses carry only `feeBps`; recover the absolute amount from it. */
function feeFromBps(sellAmount: string, feeBps?: string): string | undefined {
  if (!feeBps) return undefined;
  try {
    return applyBps(sellAmount, Number(feeBps));
  } catch {
    return undefined;
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
