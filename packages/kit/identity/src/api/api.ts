/**
 * The identity surface, as one interface.
 *
 * Two ACTA services sit behind it — the DID resolver at `did.acta.build` and the
 * credentials API at `api.*.acta.build` — but everything above this file sees a
 * single transport, so the live client and the mock cannot drift into two
 * different behaviours. Same shape as the Etherfuse adapter's `EtherfuseApi`,
 * for the same reason.
 *
 * Both services use the same prepare/submit pattern: the server builds an
 * unsigned transaction, a wallet signs it, the server submits it. Neither ever
 * holds a private key, and neither can act without a signature.
 */

export type IdentityMode = 'live' | 'mock';

export interface PreparedTx {
  /**
   * The DID the transaction registers. We mint the identifier locally and send
   * it, rather than reading it back, so nothing here depends on the prepare
   * response echoing it.
   */
  did?: string;
  xdr: string;
  networkPassphrase: string;
}

/** The on-chain record, flattened to what a verifier actually needs. */
export interface DidRecord {
  did: string;
  /** The classic `G…` account that may mutate this DID. */
  controller: string;
  /** Multibase keys. At least one; the same key may also be an assertion key. */
  authentication: string[];
  version: number;
  deactivated: boolean;
}

/** What the vault says about a credential right now. Never taken from a payload. */
export type VcStatus = 'valid' | 'revoked' | 'invalid' | 'unknown';

export interface VcIssueRequest {
  /** Vault owner. Must be the wallet bound to the API key. */
  owner: string;
  vcId: string;
  /** The credential itself, as a JSON string. Encrypted by the API before storage. */
  vcData: string;
  /** Signing issuer account. */
  issuer: string;
  /** Registered did:stellar whose on-chain controller equals `issuer`. */
  issuerDid: string;
  sourcePublicKey: string;
}

export interface IdentityApi {
  readonly mode: IdentityMode;

  /**
   * Mint an identifier, build the record from the controller's own key, and ask
   * the resolver for an unsigned registration transaction.
   */
  prepareDidRegistration(controller: string): Promise<PreparedTx>;
  submitDidTx(signedXdr: string): Promise<{ txId: string }>;
  /** `null` when the DID is simply not registered — that is an answer, not a failure. */
  getDidRecord(did: string): Promise<DidRecord | null>;

  prepareVcIssue(req: VcIssueRequest): Promise<PreparedTx>;
  submitVcIssue(signedXdr: string): Promise<{ txId: string }>;
  verifyVc(req: { owner: string; vcId: string }): Promise<{ status: VcStatus; since?: string }>;
}

// ── Wire shapes ───────────────────────────────────────────────────────────────

/** `POST /v1/dids/stellar` — the record we send, mirroring the contract's fields. */
export interface DidRecordInput {
  controller: string;
  authentication: Array<{ publicKeyMultibase: string }>;
  assertionMethod: Array<{ publicKeyMultibase: string }>;
  keyAgreement: Array<{ publicKeyMultibase: string }>;
  services: Array<{ idSuffix: string; serviceType: string; serviceEndpoint: string }>;
}

/** `GET /v1/dids/stellar/{did}` — the raw record, without the W3C wrapping. */
export interface DidRecordResponse {
  did?: string;
  didId?: string;
  record?: {
    controller?: string;
    authentication?: Array<{ publicKeyMultibase?: string }>;
    version?: number;
    deactivated?: boolean;
  };
}

export interface PreparedTxResponse {
  xdr?: string;
  network?: string;
  networkPassphrase?: string;
}
