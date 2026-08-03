/**
 * The Etherfuse ramp API surface, as one interface.
 *
 * Both the live HTTP client and the fixture-backed mock implement this, so
 * `adapter.ts` has a single code path regardless of mode. That is the whole
 * point: mock mode is not a parallel implementation that can drift, it is the
 * same adapter talking to a different transport.
 */

export type EtherfuseDirection = 'onramp' | 'offramp';

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
  quoteId: string;
  sourceAmount: string;
  targetAmount: string;
  /** targetAmount per 1 sourceAsset. */
  rate?: string;
  fee?: string;
  feeCurrency?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface EtherfuseOrderRequest {
  orderId: string;
  bankAccountId: string;
  /** Classic `G…` address. Passkey/contract `C…` addresses are rejected. */
  publicKey: string;
  quoteId: string;
}

export interface EtherfuseOrderResponse {
  orderId: string;
  quoteId?: string;
  status: string;
  sourceAmount?: string;
  targetAmount?: string;

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

export interface EtherfuseAsset {
  code?: string;
  symbol?: string;
  blockchain?: string;
  currency?: string;
  issuer?: string;
  [key: string]: unknown;
}

export interface EtherfuseOnboardingRequest {
  customerId: string;
  /** Where Etherfuse sends the customer back after KYC. */
  redirectUrl?: string;
}

export interface EtherfuseOnboardingResponse {
  url: string;
  customerId?: string;
  bankAccountId?: string;
  [key: string]: unknown;
}

export interface EtherfuseApi {
  readonly mode: 'live' | 'mock';

  createOnboardingUrl(req: EtherfuseOnboardingRequest): Promise<EtherfuseOnboardingResponse>;
  quote(req: EtherfuseQuoteRequest): Promise<EtherfuseQuoteResponse>;
  createOrder(req: EtherfuseOrderRequest): Promise<EtherfuseOrderResponse>;
  getOrder(orderId: string): Promise<EtherfuseOrderResponse>;
  regenerateTx(orderId: string): Promise<EtherfuseOrderResponse>;
  listAssets(): Promise<EtherfuseAsset[]>;

  /** Sandbox only. */
  simulateFiatReceived(orderId: string): Promise<EtherfuseOrderResponse>;
  simulateCryptoReceived(orderId: string): Promise<EtherfuseOrderResponse>;
}
