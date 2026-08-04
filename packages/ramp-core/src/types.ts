/**
 * The contract every anchor adapter implements.
 *
 * Shaped after SEP-38 (quotes) and SEP-24/SEP-6 (orders) rather than after any
 * one anchor's private API. That direction matters: Etherfuse, Manteca and
 * Koywe each speak their own dialect, but if the *kit's* vocabulary is the
 * ecosystem standard, then adding an anchor is writing one adapter and adding
 * a SEP-compliant anchor is nearly free.
 */

import type { AssetId, CountryCode } from './assets';

// ── Modes ─────────────────────────────────────────────────────────────────────

/**
 * Whether an adapter is talking to a real remote or replaying fixtures.
 * Surfaced all the way to the UI: a demo that quietly fakes a quote is worth
 * nothing, a demo that labels which quotes are simulated is worth a lot.
 */
export type AdapterMode = 'live' | 'mock';

export type RampDirection = 'onramp' | 'offramp';

// ── Quotes ────────────────────────────────────────────────────────────────────

export interface QuoteRequest {
  /** What the user gives up. `iso4217:BRL` for an on-ramp. */
  sellAsset: AssetId;
  /** What the user receives. `stellar:TESOURO:GC3C...` for an on-ramp. */
  buyAsset: AssetId;
  /** Exactly one of sellAmount / buyAmount must be set. */
  sellAmount?: string;
  buyAmount?: string;
  country?: CountryCode;
  /** Stellar account that will receive or send the asset. Classic `G...`. */
  account?: string;
  /** Anchor-scoped customer id, when the anchor requires KYC context to quote. */
  customerId?: string;
}

export interface QuoteFee {
  amount: string;
  asset: AssetId;
  /** Optional line-item breakdown, when the anchor gives one. */
  detail?: Array<{ name: string; amount: string }>;
}

export interface Quote {
  id: string;
  anchorId: string;
  anchorName: string;
  mode: AdapterMode;
  direction: RampDirection;

  sellAsset: AssetId;
  buyAsset: AssetId;
  sellAmount: string;
  buyAmount: string;

  /** buyAmount per 1 sellAsset, as a decimal string. */
  price: string;
  fee: QuoteFee;

  /** ISO-8601. Etherfuse quotes expire in seconds — always honour this. */
  expiresAt: string;
  /** Round-trip time of the quote call. The router ranks partly on this. */
  latencyMs: number;

  /**
   * `indicative` needs no auth and cannot be executed (SEP-38 /price).
   * `firm` is executable and reservable (SEP-38 /quote, or any anchor order flow).
   */
  firmness: 'indicative' | 'firm';

  /** The anchor's untouched payload. Never sent to the browser. */
  raw?: unknown;
}

// ── Orders ────────────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'created'
  /** On-ramp: waiting for the user to pay the PIX. */
  | 'awaiting_payment'
  /** Off-ramp: waiting for the user to sign and submit the burn transaction. */
  | 'awaiting_signature'
  /** Anchor is settling — funds moving on one side or the other. */
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired';

/** Terminal states — stop polling. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ['completed', 'failed', 'expired'];

export const isTerminal = (s: OrderStatus): boolean => TERMINAL_STATUSES.includes(s);

export interface PixInstructions {
  type: 'pix';
  /** The copia-e-cola string the user pastes into their bank app. */
  code: string;
  /** Data-URL or remote URL for the QR, when the anchor provides one. */
  qrImage?: string;
  amount: string;
  currency: string;
  expiresAt?: string;
  beneficiary?: string;
}

export interface BankInstructions {
  type: 'bank';
  rail: string;
  reference?: string;
  accountLabel?: string;
  amount: string;
  currency: string;
}

export type PaymentInstructions = PixInstructions | BankInstructions;

export interface CreateOrderRequest {
  quoteId: string;
  /** Stellar account receiving (on-ramp) or sending (off-ramp) the asset. */
  account: string;
  customerId?: string;
  bankAccountId?: string;
  /** Optional client-supplied idempotency key; adapters generate one otherwise. */
  orderId?: string;
}

export interface OrderStatusEvent {
  status: OrderStatus;
  at: string;
  note?: string;
}

export interface Order {
  id: string;
  anchorId: string;
  anchorName: string;
  mode: AdapterMode;
  direction: RampDirection;
  status: OrderStatus;
  quoteId?: string;

  sellAsset: AssetId;
  buyAsset: AssetId;
  sellAmount: string;
  buyAmount: string;

  /** How the user funds an on-ramp: the PIX code and its QR. */
  paymentInstructions?: PaymentInstructions;

  /**
   * An unsigned transaction the user must sign in their wallet:
   *   - on-ramp: a trustline claim, when the account cannot yet hold the asset
   *   - off-ramp: the burn/transfer that sends the asset back to the anchor
   * These expire with the quote — see `regenerateTx`.
   */
  unsignedTxXdr?: string;
  /** Hash once submitted, so the UI can deep-link to an explorer. */
  txHash?: string;

  /**
   * The anchor's own hosted page for this order, when it publishes one.
   * Linking it is the strongest authenticity signal a demo can give: the same
   * order id, on the anchor's domain, showing the same state.
   */
  anchorPage?: string;

  /**
   * Stellar account the asset must be returned to on an off-ramp. Anchors that
   * hand back a ready-made `unsignedTxXdr` omit this; anchors that expect the
   * client to build the payment itself (and our own mock) provide it instead.
   */
  anchorAccount?: string;
  /** Memo the anchor needs on that payment to reconcile it. */
  anchorMemo?: string;

  createdAt: string;
  updatedAt: string;
  history: OrderStatusEvent[];

  /** Human-readable reason when `status` is `failed`. */
  failureReason?: string;

  raw?: unknown;
}

// ── Adapter capabilities ──────────────────────────────────────────────────────

export interface SupportedCorridor {
  direction: RampDirection;
  sellAsset: AssetId;
  buyAsset: AssetId;
  country: CountryCode;
  rail: string;
  min?: string;
  max?: string;
}

export interface AdapterFeatures {
  /** Can produce executable quotes, not just indicative prices. */
  firmQuotes: boolean;
  /** Full order lifecycle, vs quote-only (testanchor's unauthenticated SEP-38). */
  orders: boolean;
  /** Exposes sandbox hooks to fake the fiat/crypto legs. */
  sandboxSimulation: boolean;
  /** Hands back an interactive URL for KYC or deposit (SEP-24). */
  interactive: boolean;
}

export interface AdapterCapabilities {
  /** Stable slug, e.g. `etherfuse`. Used as `anchorId` everywhere. */
  id: string;
  name: string;
  mode: AdapterMode;
  countries: CountryCode[];
  corridors: SupportedCorridor[];
  features: AdapterFeatures;
  /** Shown in the UI next to a mock badge, so nobody mistakes it for live. */
  note?: string;
  docsUrl?: string;
}

// ── The adapter ───────────────────────────────────────────────────────────────

export interface RampAdapter {
  capabilities(): AdapterCapabilities;

  /** Throws `RampError('UNSUPPORTED_PAIR')` when the corridor is not served. */
  getQuote(req: QuoteRequest): Promise<Quote>;

  createOrder(req: CreateOrderRequest): Promise<Order>;
  getOrder(orderId: string): Promise<Order>;

  /** Refresh an expired unsigned transaction without losing the order. */
  regenerateTx?(orderId: string): Promise<Order>;

  /** Sandbox-only: pretend the user paid the PIX. */
  simulateFiatReceived?(orderId: string): Promise<Order>;
  /** Sandbox-only: pretend the burn transaction landed. */
  simulateCryptoReceived?(orderId: string): Promise<Order>;

  /** SEP-24 style: a URL to drop the user into for KYC or an interactive flow. */
  getInteractiveUrl?(req: QuoteRequest): Promise<string>;
}

/** Adapters are built by factories so mode/credentials are injected, not global. */
export interface AdapterConfig {
  mode?: AdapterMode;
}

/**
 * Does this adapter serve the corridor being asked for?
 *
 * Every field the caller supplies narrows the match; every field it omits is a
 * wildcard. `direction` is part of that — an anchor can ramp BRL→TESOURO in one
 * direction only, and treating a request that names a direction as if it had
 * not is how an off-ramp ends up quoted by an on-ramp-only corridor.
 */
export function supportsCorridor(
  caps: AdapterCapabilities,
  req: Pick<QuoteRequest, 'sellAsset' | 'buyAsset' | 'country'> & { direction?: RampDirection },
): boolean {
  return caps.corridors.some(
    (c) =>
      c.sellAsset === req.sellAsset &&
      c.buyAsset === req.buyAsset &&
      (!req.country || c.country === req.country) &&
      (!req.direction || c.direction === req.direction),
  );
}
