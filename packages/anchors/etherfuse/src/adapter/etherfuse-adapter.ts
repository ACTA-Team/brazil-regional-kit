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
  add,
  applyBps,
  multiply,
  isFiat,
  isNative,
  parseAsset,
  divide,
  round,
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
import type { EtherfuseApi, EtherfuseOrderResponse, EtherfuseQuoteResponse } from '../api/api';
import { EtherfuseHttpClient, ETHERFUSE_SANDBOX_URL } from '../api/client';
import { EtherfuseMockClient, type EtherfuseMockOptions } from '../api/mock';

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
  // Off-ramp: the anchor confirmed the on-chain leg and owes the fiat payout.
  FUNDED: 'processing',
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

/**
 * What the adapter remembers about a quote once an order references it.
 *
 * `quoted` is the reason this is not just the request. A BRL order response
 * carries neither `destinationAmount` nor `exchangeRate` — only the deposit
 * figure — so the amount the customer is about to receive exists nowhere except
 * in the quote that produced the order. Keeping it means the order can still
 * answer "and how much TESOURO is that?" instead of saying zero.
 */
interface QuoteContext {
  req: QuoteRequest;
  direction: RampDirection;
  /** The buy amount the anchor quoted, for orders whose response omits it. */
  quoted?: string;
}

export class EtherfuseAdapter implements RampAdapter {
  private readonly api: EtherfuseApi;
  private readonly config: EtherfuseAdapterConfig;
  /** Remembers each order's corridor, so `getOrder` can rebuild a full Order. */
  private readonly context = new Map<string, QuoteContext>();

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
    const sellAmount = raw.sourceAmount ?? req.sellAmount;
    const buyAmount = raw.destinationAmount ?? '0';

    this.context.set(resolvedId, {
      req,
      direction,
      quoted: buyAmount === '0' ? undefined : buyAmount,
    });

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

    const payload = {
      orderId,
      bankAccountId: req.bankAccountId ?? this.config.bankAccountId ?? '',
      publicKey: assertClassicAddress(req.account),
      quoteId: req.quoteId,
    };

    let raw: EtherfuseOrderResponse;
    try {
      raw = await this.api.createOrder(payload);
    } catch (e) {
      if (isDuplicatePendingOrder(e)) return this.reprice(req, ctx, e);
      if (!isUnauthorizedWallet(e)) throw toRampError(e, ETHERFUSE_ID);

      /*
       * Etherfuse authorises wallets per customer, not per API key. Any visitor
       * who is not whoever ran the setup script is refused here — and only
       * here, because the quote before it succeeded: a price does not depend on
       * who receives it. So the app looks like it works right up to the last
       * step, for everyone except its author.
       *
       * Posting the address to the onboarding endpoint registers it, and the
       * identical order then succeeds. Verified against the live sandbox with a
       * freshly generated keypair: 400 before, 200 after. Doing it lazily costs
       * one extra call the first time a wallet appears and nothing afterwards.
       */
      try {
        await this.authorizeWallet(payload.publicKey, req.customerId, payload.bankAccountId);
      } catch {
        // A failure to self-register is not something the person staring at the
        // screen can act on. The anchor's refusal is, so that is what surfaces.
        throw toRampError(e, ETHERFUSE_ID);
      }

      try {
        raw = await this.api.createOrder(payload);
      } catch (retry) {
        if (!isDuplicatePendingOrder(retry)) throw toRampError(retry, ETHERFUSE_ID);
        return this.reprice(req, ctx, retry);
      }
    }

    if (ctx) this.context.set(raw.orderId ?? orderId, ctx);
    return this.toOrder(raw, ctx);
  }

  /**
   * Ask again for a few cents more, because the round number is taken.
   *
   * Etherfuse allows one pending order per (bank account, amount), and every
   * visitor shares the operator's bank account. One person who opens a `500`
   * order and walks away blocks `500` for everyone afterwards — and `500` is a
   * preset button, so that is the likely case rather than the unlucky one.
   *
   * Cents give each attempt its own lane. Nothing is hidden by doing so: the
   * new amount is what the order carries and what the payment instructions ask
   * for, so the screen and the anchor agree. Re-quoting rather than editing the
   * figure is what keeps that true — the price, the fee and the amount received
   * are all the anchor's answer for the amount actually being paid.
   */
  private async reprice(
    req: CreateOrderRequest,
    ctx: { req: QuoteRequest; direction: RampDirection } | undefined,
    original: unknown,
  ): Promise<Order> {
    // Without the original request there is nothing to re-quote from, and
    // guessing the amount would be worse than reporting the refusal.
    if (!ctx?.req.sellAmount) throw toRampError(original, ETHERFUSE_ID);

    const nudged = nudgeAmount(ctx.req.sellAmount);
    try {
      const quote = await this.getQuote({ ...ctx.req, sellAmount: nudged });
      return await this.createOrder({ ...req, quoteId: quote.id, orderId: crypto.randomUUID() });
    } catch (e) {
      // If the second amount is also refused, say so with the anchor's first
      // and clearest complaint rather than a confusing one about a number the
      // user never typed.
      if (isDuplicatePendingOrder(e)) throw toRampError(original, ETHERFUSE_ID);
      throw toRampError(e, ETHERFUSE_ID);
    }
  }

  /**
   * Register a wallet against this operator's customer.
   *
   * The endpoint is named for the KYC URL it returns, but the registration is
   * the part that matters here — the URL is discarded. A wallet belongs to
   * exactly one organisation, so this cannot take an address away from another
   * operator; a second attempt on an already-registered wallet is a no-op.
   */
  private async authorizeWallet(
    publicKey: string,
    customerId: string | undefined,
    bankAccountId: string,
  ): Promise<void> {
    await this.api.createOnboardingUrl({
      customerId: customerId ?? this.config.customerId ?? '',
      bankAccountId,
      publicKey,
      blockchain: 'stellar',
      userInfo: {
        email: this.config.userEmail ?? 'sandbox@brazil-regional-kit.demo',
        displayName: this.config.userDisplayName ?? 'BRK Sandbox',
      },
    });
  }

  async getOrder(orderId: string): Promise<Order> {
    const ctx = this.context.get(orderId);
    try {
      const raw = await this.api.getOrder(orderId);
      return this.toOrder(raw, ctx);
    } catch (e) {
      throw toRampError(e, ETHERFUSE_ID);
    }
  }

  async regenerateTx(orderId: string): Promise<Order> {
    const ctx = this.context.get(orderId);
    try {
      const raw = await this.api.regenerateTx(orderId);
      // Same acknowledge-only behaviour as the settlement hooks.
      const resolved = raw?.orderId ? raw : await this.api.getOrder(orderId);
      return this.toOrder(resolved, ctx);
    } catch (e) {
      throw toRampError(e, ETHERFUSE_ID);
    }
  }

  /*
   * The settlement hooks answer 200 with an EMPTY body — they acknowledge, they
   * do not describe. Mapping that emptiness as if it were an order produced one
   * with no id, which crashed the first component that touched it. When the
   * hook says nothing, ask the order itself.
   */
  async simulateFiatReceived(orderId: string): Promise<Order> {
    const ctx = this.context.get(orderId);
    try {
      const raw = await this.api.simulateFiatReceived(orderId);
      const resolved = raw?.orderId ? raw : await this.api.getOrder(orderId);
      return this.toOrder(resolved, ctx);
    } catch (e) {
      throw toRampError(e, ETHERFUSE_ID);
    }
  }

  async simulateCryptoReceived(orderId: string): Promise<Order> {
    const ctx = this.context.get(orderId);
    try {
      const raw = await this.api.simulateCryptoReceived(orderId);
      const resolved = raw?.orderId ? raw : await this.api.getOrder(orderId);
      return this.toOrder(resolved, ctx);
    } catch (e) {
      /*
       * The live sandbox has no crypto_received route at all — the guide
       * documents one, the API answers 404 for real and bogus ids alike. And it
       * does not need one: the crypto leg of an off-ramp is a genuine on-chain
       * payment even in sandbox, carrying the anchor's own reconciliation memo,
       * so their watcher picks it up without being told. Only the FIAT leg
       * needs a simulation hook, because no real money moves in sandbox.
       *
       * So a 404 here is not a failure — it means "nothing to simulate, the
       * chain already said it". Fall through to the order's actual state.
       */
      const err = toRampError(e, ETHERFUSE_ID);
      if (err.status === 404) {
        try {
          const resolved = await this.api.getOrder(orderId);
          return this.toOrder(resolved, ctx);
        } catch {
          /* fall through to the original error */
        }
      }
      throw err;
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

  private toOrder(raw: EtherfuseOrderResponse, ctx?: QuoteContext): Order {
    const req = ctx?.req;
    const direction = ctx?.direction;
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
    // Off-ramp orders put the amount on the token side under yet another name.
    const tokenAmount = raw.amountInTokens ?? raw.sourceAmount ?? '0';
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
      sellAmount: resolvedDirection === 'onramp' ? fiatAmount : tokenAmount,
      /*
       * Only the create response carries destinationAmount; the fetched order
       * does not. Without this, every poll overwrote the delivered amount with
       * zero — and the success banner announced "0 TESOURO" while the wallet
       * showed the real balance. exchangeRate is post-fee destination-per-source,
       * so the product is exactly what the anchor delivers.
       */
      buyAmount:
        raw.destinationAmount ??
        deriveBuyAmount(
          resolvedDirection,
          resolvedDirection === 'onramp' ? fiatAmount : tokenAmount,
          raw.exchangeRate,
        ) ??
        // A live BRL order comes back with the deposit figure and nothing else:
        // no destination amount, no rate. The quote that produced this order is
        // then the only record of what the customer receives, and showing a
        // confident `0` next to a real PIX request is worse than showing
        // nothing.
        ctx?.quoted ??
        '0',

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
      anchorPage: raw.statusPage,
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

function deriveBuyAmount(
  direction: RampDirection,
  fiatAmount: string,
  exchangeRate?: string,
): string | undefined {
  // exchangeRate is destination-per-source in both directions.
  if (!exchangeRate || fiatAmount === '0') return undefined;
  try {
    return multiply(fiatAmount, exchangeRate);
  } catch {
    return undefined;
  }
}

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
 * The one refusal that a retry can fix.
 *
 * Etherfuse answers an unregistered wallet with a bare `400 Wallet not found or
 * not authorized`. The status alone cannot be trusted to mean this — 400 also
 * covers malformed payloads and sandbox limits, and re-registering a wallet in
 * response to those would hide a real bug behind a pointless extra call. So the
 * match is on the anchor's own sentence.
 */
function isUnauthorizedWallet(error: unknown): boolean {
  const message = (error as { message?: string } | undefined)?.message ?? String(error ?? '');
  return /wallet not found or not authori[sz]ed/i.test(message);
}

/**
 * The other refusal a retry can clear: the amount is taken, not the request.
 */
function isDuplicatePendingOrder(error: unknown): boolean {
  const message = (error as { message?: string } | undefined)?.message ?? String(error ?? '');
  return /pending (on|off)ramp order already exists/i.test(message);
}

/**
 * Move an amount onto a free lane by adding one to ninety-nine centavos.
 *
 * Random rather than derived from the wallet: a person who abandons an order
 * and tries the same button again would otherwise land on their own blocked
 * amount every time. Decimal strings throughout — `add` is the money helper,
 * because doing this in floating point is how a payment ends up a centavo off.
 */
function nudgeAmount(amount: string): string {
  const centavos = 1 + Math.floor(Math.random() * 99);
  return round(add(amount, divide(String(centavos), '100')), 2);
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
