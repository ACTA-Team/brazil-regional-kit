/**
 * SEP-10 — Stellar Web Authentication.
 *
 * The anchor hands you a transaction and asks you to sign it. That is a
 * genuinely dangerous shape: a hostile or spoofed anchor could hand you a real
 * payment and collect a signature for it. SEP-10 defends against this with a
 * set of invariants — sequence number 0 so the transaction can never be
 * submitted, the anchor's own `SIGNING_KEY` as the source, a `manage_data`
 * operation naming the expected home domain, a matching web-auth domain.
 *
 * `readChallengeTx` from the SDK checks all of them, so **verification is not
 * optional here**. We refuse to pass an unverified challenge to the wallet.
 */

import { Networks, Transaction, WebAuth } from '@stellar/stellar-sdk';
import { RampError } from '@brk/ramp-core';

export interface Sep10Options {
  /** From the TOML's `WEB_AUTH_ENDPOINT`. */
  webAuthEndpoint: string;
  /** From the TOML's `SIGNING_KEY` — the only key allowed to source a challenge. */
  serverSigningKey: string;
  /** The anchor's home domain, e.g. `testanchor.stellar.org`. */
  homeDomain: string;
  networkPassphrase?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ChallengeResult {
  transaction: string;
  networkPassphrase: string;
  /** The account the challenge was issued for. */
  clientAccountId: string;
  /** Present when the anchor requires a memo to disambiguate a shared account. */
  memo?: string;
}

export class Sep10Client {
  private readonly opts: Required<Omit<Sep10Options, 'fetchImpl'>> & {
    fetchImpl: typeof fetch;
  };

  constructor(options: Sep10Options) {
    this.opts = {
      webAuthEndpoint: options.webAuthEndpoint.replace(/\/+$/, ''),
      serverSigningKey: options.serverSigningKey,
      homeDomain: options.homeDomain.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
      networkPassphrase: options.networkPassphrase ?? Networks.TESTNET,
      timeoutMs: options.timeoutMs ?? 10_000,
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
    };
  }

  /** Web-auth domain is the host of the auth endpoint, not the home domain. */
  private get webAuthDomain(): string {
    return new URL(this.opts.webAuthEndpoint).host;
  }

  /**
   * Step 1: request a challenge and verify it before it ever reaches a wallet.
   * Throws rather than returning an unverified transaction — there is no safe
   * "just sign it anyway" path.
   */
  async challenge(account: string, clientDomain?: string): Promise<ChallengeResult> {
    const params = new URLSearchParams({ account, home_domain: this.opts.homeDomain });
    if (clientDomain) params.set('client_domain', clientDomain);

    const payload = await this.request<{
      transaction?: string;
      network_passphrase?: string;
      error?: string;
    }>(`${this.opts.webAuthEndpoint}?${params}`, { method: 'GET' });

    if (!payload.transaction) {
      throw new RampError({
        code: 'AUTH_FAILED',
        message: payload.error ?? 'The anchor returned no SEP-10 challenge.',
        raw: payload,
      });
    }

    const networkPassphrase = payload.network_passphrase ?? this.opts.networkPassphrase;

    let read: ReturnType<typeof WebAuth.readChallengeTx>;
    try {
      read = WebAuth.readChallengeTx(
        payload.transaction,
        this.opts.serverSigningKey,
        networkPassphrase,
        this.opts.homeDomain,
        this.webAuthDomain,
      );
    } catch (cause) {
      throw new RampError({
        code: 'AUTH_FAILED',
        message:
          `SEP-10 challenge from ${this.opts.homeDomain} failed verification: ` +
          `${cause instanceof Error ? cause.message : String(cause)}. Refusing to sign it.`,
        cause,
      });
    }

    // Belt and braces: a challenge must never be submittable.
    const tx = read.tx as Transaction;
    if (tx.sequence !== '0') {
      throw new RampError({
        code: 'AUTH_FAILED',
        message: `SEP-10 challenge has sequence ${tx.sequence}, expected 0. Refusing to sign it.`,
      });
    }
    if (read.clientAccountID !== account) {
      throw new RampError({
        code: 'AUTH_FAILED',
        message: `SEP-10 challenge was issued for ${read.clientAccountID}, not ${account}.`,
      });
    }

    return {
      transaction: payload.transaction,
      networkPassphrase,
      clientAccountId: read.clientAccountID,
      memo: read.memo ?? undefined,
    };
  }

  /** Step 2: exchange the signed challenge for a JWT. */
  async token(signedTransaction: string): Promise<string> {
    const payload = await this.request<{ token?: string; error?: string }>(
      this.opts.webAuthEndpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedTransaction }),
      },
    );

    if (!payload.token) {
      throw new RampError({
        code: 'AUTH_FAILED',
        message: payload.error ?? 'The anchor did not return a SEP-10 token.',
        raw: payload,
      });
    }
    return payload.token;
  }

  /**
   * The whole handshake. `sign` is injected so this works with Freighter in the
   * browser and with a raw keypair in a script or test.
   */
  async authenticate(
    account: string,
    sign: (xdr: string, networkPassphrase: string) => Promise<string>,
  ): Promise<string> {
    const challenge = await this.challenge(account);
    const signed = await sign(challenge.transaction, challenge.networkPassphrase);
    return this.token(signed);
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const response = await this.opts.fetchImpl(url, { ...init, signal: controller.signal });
      const text = await response.text();
      const payload = text ? (JSON.parse(text) as T) : ({} as T);
      if (!response.ok && !(payload as { error?: string }).error) {
        throw new RampError({
          code: response.status === 401 ? 'AUTH_FAILED' : 'ANCHOR_UNAVAILABLE',
          message: `SEP-10 request returned ${response.status}`,
          status: response.status,
        });
      }
      return payload;
    } catch (cause) {
      if (cause instanceof RampError) throw cause;
      throw new RampError({
        code: 'ANCHOR_UNAVAILABLE',
        message: `SEP-10 request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Decode a JWT payload without verifying it — for display only, never trust. */
export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
