/**
 * Live ACTA identity client.
 *
 * Two hosts, one client, because callers should not care which service answers:
 *
 *   - `did.acta.build` — the DID resolver. No authentication, no key custody: it
 *     reads the registry contract over RPC and builds unsigned XDRs. Resolution
 *     is free, so eligibility checks cost nothing on-chain.
 *   - `api.<network>.acta.build` — the credentials API. Needs `X-ACTA-Key`, and
 *     the key is bound to a wallet: the vault `owner` must be that wallet, which
 *     is why attestations live in the hub's own vault rather than the user's.
 *
 * Both answer errors as `{ code, message }` (the credentials API sometimes says
 * `error` instead of `code`). Those codes are stable and documented, so we branch
 * on them and never on message text.
 */

import { RampError, stripTrailingSlashes } from '@brk/ramp-core';
import type { RampErrorCode } from '@brk/ramp-core';
import { buildDid, generateDidId } from '../did/did';
import { walletKeyToMultikey } from '../keys/stellar-key';
import type {
  DidRecord,
  DidRecordInput,
  DidRecordResponse,
  IdentityApi,
  PreparedTx,
  PreparedTxResponse,
  VcIssueRequest,
  VcStatus,
} from './api';

export const DID_RESOLVER_URL = 'https://did.acta.build';
export const ACTA_TESTNET_API_URL = 'https://api.testnet.acta.build';
export const ACTA_MAINNET_API_URL = 'https://api.acta.build';

export const IDENTITY_ANCHOR_ID = 'acta';

export const ENDPOINTS = {
  didRegister: '/v1/dids/stellar',
  didSubmit: '/v1/dids/stellar/submit',
  didRecord: (did: string) => `/v1/dids/stellar/${encodeURIComponent(did)}`,
  vcIssue: '/contracts/vc/issue',
  vcVerify: '/contracts/vault/verify-vc',
} as const;

/**
 * ACTA's documented error codes, mapped onto the kit's taxonomy.
 *
 * Deliberately no new `RampErrorCode`: every one of these already has a meaning,
 * an HTTP status in the hub and translated copy in three languages. Adding an
 * `IDENTITY_UNAVAILABLE` would differ from `ANCHOR_UNAVAILABLE` only in wording.
 */
const ERROR_CODES: Record<string, RampErrorCode> = {
  did_invalid: 'INVALID_REQUEST',
  did_not_found: 'INVALID_REQUEST',
  did_already_exists: 'INVALID_ORDER_STATE',
  did_deactivated: 'INVALID_ORDER_STATE',
  version_mismatch: 'INVALID_ORDER_STATE',
  multikey_unsupported: 'INVALID_REQUEST',
  issuerDid_controller_mismatch: 'INVALID_REQUEST',
  batch_too_large: 'INVALID_REQUEST',
  rate_limited: 'ANCHOR_UNAVAILABLE',
  tx_submission_failed: 'ANCHOR_UNAVAILABLE',
};

/** Set by the client when it recognises an already-registered credential. */
export const ALREADY_EXISTS_CODES = new Set(['did_already_exists', 'vc_already_exists']);

export interface IdentityClientOptions {
  /** Required for credential operations. Resolution works without it. */
  apiKey?: string;
  /** Credentials API base. Defaults to testnet. */
  actaUrl?: string;
  resolverUrl?: string;
  network?: 'testnet' | 'mainnet';
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ActaErrorBody {
  code?: string;
  error?: string;
  message?: string;
  raw?: string;
}

export class ActaIdentityClient implements IdentityApi {
  readonly mode = 'live' as const;

  private readonly apiKey?: string;
  private readonly actaUrl: string;
  private readonly resolverUrl: string;
  private readonly network: 'testnet' | 'mainnet';
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: IdentityClientOptions = {}) {
    this.apiKey = opts.apiKey;
    this.network = opts.network ?? 'testnet';
    this.actaUrl = stripTrailingSlashes(
      opts.actaUrl ?? (this.network === 'mainnet' ? ACTA_MAINNET_API_URL : ACTA_TESTNET_API_URL),
    );
    this.resolverUrl = stripTrailingSlashes(opts.resolverUrl ?? DID_RESOLVER_URL);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  private async request<T>(
    base: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    opts: { authenticated?: boolean } = {},
  ): Promise<T | null> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (opts.authenticated) {
      if (!this.apiKey) {
        // Fail before the request rather than after: a missing key is a
        // configuration problem, and a 401 from the network says less about it.
        throw new RampError({
          code: 'AUTH_FAILED',
          anchorId: IDENTITY_ANCHOR_ID,
          message: 'ACTA API key missing — set ACTA_API_KEY or use identity mock mode.',
        });
      }
      headers['X-ACTA-Key'] = this.apiKey;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new RampError({
        code: 'ANCHOR_UNAVAILABLE',
        anchorId: IDENTITY_ANCHOR_ID,
        message: `ACTA ${method} ${path} failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        cause,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    // A DID that was never registered is a legitimate answer to "is this
    // registered?", not a failure. Everything above reads `null` as "no".
    if (response.status === 404) return null;
    if (!response.ok) throw this.toError(response.status, payload, method, path);
    return payload as T;
  }

  private toError(status: number, payload: unknown, method: string, path: string): RampError {
    const body = payload as ActaErrorBody;
    const actaCode = body?.code ?? body?.error;
    const message =
      body?.message ?? actaCode ?? body?.raw?.trim() ?? `ACTA ${method} ${path} returned ${status}`;

    const code: RampErrorCode =
      (actaCode ? ERROR_CODES[actaCode] : undefined) ??
      (status === 401 || status === 403
        ? 'AUTH_FAILED'
        : status === 409 || status === 410
          ? 'INVALID_ORDER_STATE'
          : status === 429 || status >= 500
            ? 'ANCHOR_UNAVAILABLE'
            : status >= 400
              ? 'INVALID_REQUEST'
              : 'UNKNOWN');

    return new RampError({
      code,
      anchorId: IDENTITY_ANCHOR_ID,
      message,
      status,
      raw: payload,
    });
  }

  private prepared(payload: PreparedTxResponse | null, did?: string): PreparedTx {
    const xdr = payload?.xdr;
    if (!xdr) {
      throw new RampError({
        code: 'ANCHOR_UNAVAILABLE',
        anchorId: IDENTITY_ANCHOR_ID,
        message: 'ACTA returned no transaction to sign.',
        raw: payload,
      });
    }
    return {
      did,
      xdr,
      // The resolver names it `networkPassphrase`; the credentials API `network`.
      // Both carry the same string, and a wallet cannot sign without it.
      networkPassphrase: payload.networkPassphrase ?? payload.network ?? '',
    };
  }

  /**
   * Build the registration transaction for a new `did:stellar`.
   *
   * The controller's own wallet key becomes the authentication key: the same 32
   * Ed25519 bytes in a different encoding, which is what lets a wallet
   * signature prove control with no second key to store.
   *
   * Assertion keys split the two roles apart, which is why this takes an option
   * rather than always doing the same thing:
   *
   *   - A HOLDER — every user of this app — needs `authentication` and nothing
   *     else. That is what proves control of the DID, and it is the whole job.
   *   - An ISSUER needs an assertion key as well, or W3C verifiers reject the
   *     credentials it signs. That key must be a DIFFERENT one.
   *
   * ACTA's documentation says the same key may appear in both relationships and
   * calls that "the idiomatic issuer shape". The deployed registry answers
   * exactly that with `duplicate_key (#9)`, at prepare time, every time.
   * Verified against testnet with funded throwaway accounts: the same key in
   * both was refused; holder-only and two-distinct-keys both registered.
   *
   * The assertion key is supplied rather than invented here, because a DID
   * document advertising a key nobody holds is a lie about what that issuer can
   * sign. Whoever generates it is whoever can keep it.
   */
  async prepareDidRegistration(
    controller: string,
    options: { assertionKeyMultibase?: string } = {},
  ): Promise<PreparedTx> {
    const publicKeyMultibase = walletKeyToMultikey(controller);
    const { assertionKeyMultibase } = options;

    if (assertionKeyMultibase && assertionKeyMultibase === publicKeyMultibase) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: 'acta',
        message:
          'The assertion key must differ from the controller key. The registry ' +
          'refuses a document that repeats a key with duplicate_key (#9).',
      });
    }

    const did = buildDid(this.network, generateDidId());

    const record: DidRecordInput = {
      controller,
      authentication: [{ publicKeyMultibase }],
      assertionMethod: assertionKeyMultibase ? [{ publicKeyMultibase: assertionKeyMultibase }] : [],
      keyAgreement: [],
      services: [],
    };

    const payload = await this.request<PreparedTxResponse>(
      this.resolverUrl,
      'POST',
      ENDPOINTS.didRegister,
      { did, sourcePublicKey: controller, record },
    );
    return this.prepared(payload, did);
  }

  /**
   * Submit the signed registration.
   *
   * `network` is not optional. Every other resolver call carries the DID in the
   * path, so the API can read the network off it; this one does not, and
   * without the field it answers `400 network_invalid` — "submit body must
   * include network, no DID in the path to infer it from".
   */
  async submitDidTx(signedXdr: string): Promise<{ txId: string }> {
    const payload = await this.request<{ txId?: string; tx_id?: string }>(
      this.resolverUrl,
      'POST',
      ENDPOINTS.didSubmit,
      { signedXdr, network: this.network },
    );
    return { txId: payload?.txId ?? payload?.tx_id ?? '' };
  }

  async getDidRecord(did: string): Promise<DidRecord | null> {
    const payload = await this.request<DidRecordResponse>(
      this.resolverUrl,
      'GET',
      ENDPOINTS.didRecord(did),
    );
    if (!payload?.record) return null;

    const record = payload.record;
    return {
      did: payload.did ?? did,
      controller: record.controller ?? '',
      authentication: (record.authentication ?? [])
        .map((key) => key.publicKeyMultibase)
        .filter((key): key is string => Boolean(key)),
      version: record.version ?? 0,
      deactivated: record.deactivated ?? false,
    };
  }

  async prepareVcIssue(req: VcIssueRequest): Promise<PreparedTx> {
    const payload = await this.request<PreparedTxResponse>(
      this.actaUrl,
      'POST',
      ENDPOINTS.vcIssue,
      req,
      { authenticated: true },
    );
    return this.prepared(payload);
  }

  async submitVcIssue(signedXdr: string): Promise<{ txId: string }> {
    const payload = await this.request<{ tx_id?: string; txId?: string }>(
      this.actaUrl,
      'POST',
      ENDPOINTS.vcIssue,
      { signedXdr },
      { authenticated: true },
    );
    return { txId: payload?.tx_id ?? payload?.txId ?? '' };
  }

  async verifyVc(req: {
    owner: string;
    vcId: string;
  }): Promise<{ status: VcStatus; since?: string }> {
    const payload = await this.request<{ status?: string; since?: string }>(
      this.actaUrl,
      'POST',
      ENDPOINTS.vcVerify,
      req,
      { authenticated: true },
    );

    // A credential that was never issued reads as 404 → `null` here. That is
    // "no such credential", which for eligibility means "not attested yet".
    if (!payload) return { status: 'unknown' };

    const status = payload.status;
    const known: VcStatus[] = ['valid', 'revoked', 'invalid'];
    return {
      status: known.includes(status as VcStatus) ? (status as VcStatus) : 'unknown',
      since: payload.since,
    };
  }
}
