/**
 * The Etherfuse ramp API surface, as one interface.
 *
 * Both the live HTTP client and the fixture-backed mock implement this, so
 * `adapter.ts` has a single code path regardless of mode. That is the whole
 * point: mock mode is not a parallel implementation that can drift, it is the
 * same adapter talking to a different transport.
 *
 * These shapes were captured from the live sandbox, not from documentation.
 * Several of them differ from what the published guides describe — the response
 * field names in particular. Where they differ, the sandbox wins; see the notes
 * on each type.
 */

export type EtherfuseDirection = 'onramp' | 'offramp';

// ── Quotes ────────────────────────────────────────────────────────────────────

export interface EtherfuseQuoteRequest {
  quoteId: string;
  customerId: string;
  blockchain: 'stellar';
  walletAddress: string;
  quoteAssets: {
    type: EtherfuseDirection;
    /** `BRL` for an on-ramp; `TESOURO:GC3C…` for an off-ramp. */
    sourceAsset: string;
    targetAsset: string;
  };
  sourceAmount: string;
}

export interface EtherfuseQuoteResponse {
  /**
   * The server issues its OWN id and ignores the one you sent. Orders must
   * reference this one; using the request's id fails with an unknown quote.
   */
  quoteId: string;
  blockchain: string;
  quoteAssets: {
    type: EtherfuseDirection;
    sourceAsset: string;
    targetAsset: string;
  };
  sourceAmount: string;
  /** NOT `targetAmount` — what the customer actually receives. */
  destinationAmount: string;
  /** NOT `rate` — destination units per source unit, after fees. */
  exchangeRate: string;
  /** The pre-fee rate, at much higher precision. */
  nominalRate?: string;
  /** Basis points, as a string. `"20"` is 0.2%. */
  feeBps?: string;
  /** NOT `fee` — absolute fee in the source currency. */
  feeAmount?: string;
  /** Roughly two minutes from creation. Honour it. */
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
  /** True when the anchor has to route through another asset to fill. */
  requiresSwap?: boolean;
  [key: string]: unknown;
}

// ── Orders ────────────────────────────────────────────────────────────────────

export interface EtherfuseOrderRequest {
  orderId: string;
  bankAccountId: string;
  /** Classic `G…` address. Passkey/contract `C…` addresses are rejected. */
  publicKey: string;
  /** The id from the quote RESPONSE. */
  quoteId: string;
}

/**
 * `POST /ramp/order` wraps its payload in a direction key — `{ onramp: {…} }`
 * or `{ offramp: {…} }` — while `GET /ramp/order/{id}` returns the object flat.
 * Two shapes for the same resource; `unwrapOrder` in the client normalizes them.
 */
export interface EtherfuseOrderEnvelope {
  onramp?: EtherfuseOrderResponse;
  offramp?: EtherfuseOrderResponse;
}

export interface EtherfuseOrderResponse {
  orderId: string;
  quoteId?: string;
  /** Absent on the create response; fetch the order to learn it. */
  status?: string;
  /** `onramp` | `offramp`, on the fetched order. */
  orderType?: string;

  /** The fetched order names it `amountInFiat`; the create response `depositAmount`. */
  amountInFiat?: string;
  depositAmount?: string;
  /** Off-ramp orders carry the token side here instead. */
  amountInTokens?: string;
  sourceAmount?: string;
  destinationAmount?: string;

  /** Rate and fee, on the fetched order. */
  exchangeRate?: string;
  feeBps?: number | string;
  feeAmountInFiat?: string;

  sourceAsset?: string;
  targetAsset?: string;

  /**
   * Where to send the fiat. Which of these is populated depends on the bank
   * account the customer onboarded: a Brazilian one yields PIX details, a
   * Mexican one a CLABE. An empty `depositClabe` with `depositBankName: "STP"`
   * on a BRL order means no Brazilian account was ever added.
   */
  depositClabe?: string;
  depositBankName?: string;
  depositAccountHolder?: string;

  /** Anchor-hosted page for this order — handy to link from a UI. */
  statusPage?: string;

  /** On-ramp: how the customer pays. Field naming varies; we read defensively. */
  pixCode?: string;
  pixQrCode?: string;
  paymentInstructions?: {
    pixCode?: string;
    qrCode?: string;
    expiresAt?: string;
    [key: string]: unknown;
  };

  /** Unsigned XDR the customer must sign to establish a trustline. */
  stellarClaimTransaction?: string;
  /** Unsigned XDR that returns the asset to the anchor on an off-ramp. */
  burnTransaction?: string;
  transactionHash?: string;

  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

// ── Assets ────────────────────────────────────────────────────────────────────

/** All three parameters are mandatory; omitting any is a 400. */
export interface EtherfuseAssetsQuery {
  blockchain: string;
  /** `BRL`, `MXN`. Case-insensitive. */
  currency: string;
  /** A Stellar account — the endpoint reports per-wallet balances. */
  wallet: string;
}

export interface EtherfuseAsset {
  symbol?: string;
  /** `TESOURO:GC3C…` — ready to use as a quote asset. */
  identifier?: string;
  name?: string;
  /** Lowercase ISO code, or null for assets not tied to this currency. */
  currency?: string | null;
  balance?: string | null;
  image?: string;
  [key: string]: unknown;
}

// ── Onboarding ────────────────────────────────────────────────────────────────

export interface EtherfuseOnboardingRequest {
  customerId: string;
  /** Required at onboarding — it is NOT handed back to you afterwards. */
  bankAccountId: string;
  publicKey: string;
  blockchain: string;
  userInfo: {
    email: string;
    displayName: string;
    [key: string]: unknown;
  };
}

export interface EtherfuseOnboardingResponse {
  /** Snake case, unlike everything else in the API. Signed and short-lived. */
  presigned_url?: string;
  /** Tolerated in case the field is ever renamed to match the rest. */
  url?: string;
  [key: string]: unknown;
}

// ── The transport ─────────────────────────────────────────────────────────────

export interface EtherfuseApi {
  readonly mode: 'live' | 'mock';

  createOnboardingUrl(req: EtherfuseOnboardingRequest): Promise<EtherfuseOnboardingResponse>;
  quote(req: EtherfuseQuoteRequest): Promise<EtherfuseQuoteResponse>;
  createOrder(req: EtherfuseOrderRequest): Promise<EtherfuseOrderResponse>;
  getOrder(orderId: string): Promise<EtherfuseOrderResponse>;
  regenerateTx(orderId: string): Promise<EtherfuseOrderResponse>;
  listAssets(query: EtherfuseAssetsQuery): Promise<EtherfuseAsset[]>;

  /** Sandbox only. */
  simulateFiatReceived(orderId: string): Promise<EtherfuseOrderResponse>;
  simulateCryptoReceived(orderId: string): Promise<EtherfuseOrderResponse>;
}
