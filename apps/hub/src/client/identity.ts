'use client';

/**
 * Client-side identity: the API calls, and where the browser keeps the DID.
 *
 * **The browser is a cache, never the source of truth.** The registry is keyed
 * by DID, so nothing anywhere can answer "which DID does this wallet control?" —
 * there is no controller→DID lookup, upstream or here. What we can do is check
 * the other direction: remember a DID, and on every load resolve it and keep it
 * only if the connected wallet is still its controller. A wallet switch, a
 * cleared browser or someone else's machine all end up in the same place — the
 * DID has to be pasted back in, and the paste is verified the same way.
 */

import type { AnchorEligibility, PocChallenge } from '@brk/identity-kit';
import { ApiError } from '@/client/api';

const DID_KEY = 'brk.identity.did';

export interface IdentityStatus {
  mode: 'live' | 'mock';
  issuerDid: string | null;
  resolverUrl: string;
}

export interface DidResolution {
  registered: boolean;
  did: string;
  controller?: string;
  version?: number;
  deactivated?: boolean;
  authentication?: string[];
}

export interface PreparedRegistration {
  did: string;
  xdr: string;
  networkPassphrase: string;
  mode: 'live' | 'mock';
}

export interface AttestationResult {
  vcId: string;
  txId: string;
  alreadyIssued: boolean;
  mode: 'live' | 'mock';
}

export interface PocVerification {
  verified: boolean;
  reason?: string;
  did: string;
  controller?: string;
  mode: 'live' | 'mock';
}

export type { AnchorEligibility, PocChallenge };

/** Rebuild the error so its `code` survives the HTTP hop — the mapper reads it. */
async function json<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as
    T | { error: ConstructorParameters<typeof ApiError>[0] };
  if (payload && typeof payload === 'object' && 'error' in payload) {
    throw new ApiError((payload as { error: ConstructorParameters<typeof ApiError>[0] }).error);
  }
  return payload as T;
}

export const getIdentityStatus = async (): Promise<IdentityStatus> =>
  json(await fetch('/api/identity/status'));

export const resolveDid = async (did: string): Promise<DidResolution> =>
  json(await fetch(`/api/identity/did/resolve?did=${encodeURIComponent(did)}`));

export const prepareDid = async (address: string): Promise<PreparedRegistration> =>
  json(
    await fetch('/api/identity/did/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    }),
  );

export const submitDid = async (signedXdr: string, did: string): Promise<{ txId: string }> =>
  json(
    await fetch('/api/identity/did/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedXdr, did }),
    }),
  );

export const attest = async (did: string, anchorId: string): Promise<AttestationResult> =>
  json(
    await fetch('/api/identity/attest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did, anchorId }),
    }),
  );

export const getChallenge = async (
  did: string,
): Promise<{ challenge: PocChallenge; mode: 'live' | 'mock' }> =>
  json(await fetch(`/api/identity/challenge?did=${encodeURIComponent(did)}`));

export const verifyPoc = async (
  challenge: PocChallenge,
  signature: string,
): Promise<PocVerification> =>
  json(
    await fetch('/api/identity/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge, signature }),
    }),
  );

// ── The browser's cache ───────────────────────────────────────────────────────

export function rememberDid(did: string): void {
  window.localStorage.setItem(DID_KEY, did);
}

export function forgetDid(): void {
  window.localStorage.removeItem(DID_KEY);
}

export function recallDid(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(DID_KEY);
}

/**
 * Resolve a remembered or pasted DID and keep it only if this wallet controls it.
 *
 * Without the controller check the router page would annotate quotes against
 * whoever last used the browser — showing one person's onboarding to another,
 * which is worse than showing nothing.
 */
export async function claimDid(did: string, address: string): Promise<DidResolution | null> {
  const resolution = await resolveDid(did);

  if (!resolution.registered || resolution.deactivated) return null;
  if (resolution.controller !== address) return null;

  rememberDid(did);
  return resolution;
}
