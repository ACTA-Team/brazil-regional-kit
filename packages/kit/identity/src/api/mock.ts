/**
 * Fixture-free mock of the ACTA identity services.
 *
 * Its job is that a fresh clone with no `.env` can walk the whole flow — mint a
 * DID, get attested, prove control, watch the router chips light up — without an
 * API key, a funded issuer or a network. CI does exactly that on every push.
 *
 * Two deliberate departures from the live services, both visible rather than
 * hidden, because a mock that pretends to be real is worse than no mock:
 *
 *   - **The DID is derived from the wallet, not random.** The real method mints
 *     16 random bytes precisely so the DID is not tied to an account. Here it is
 *     the first 16 bytes of the controller's key, so reloading the page or
 *     restarting the server gives you back the same DID instead of orphaning
 *     the attestations you just made.
 *   - **Nothing is signed.** `prepare` hands back a marker string instead of an
 *     XDR, and `submit` takes it straight back. There is no transaction, so
 *     there is nothing for a wallet to sign and nothing lands on-chain.
 *
 * Every response carries `mode: 'mock'`, which the hub renders as a badge.
 */

import { RampError } from '@brk/ramp-core';
import { StrKey } from '@stellar/stellar-sdk';
import { buildDid, DID_ID_BYTES, encodeDidId, parseDid } from '../did/did';
import { assertClassicAddress, walletKeyToMultikey } from '../keys/stellar-key';
import type { DidRecord, IdentityApi, PreparedTx, VcIssueRequest, VcStatus } from './api';

/** Impossible to mistake for a real XDR, which is the point. */
export const MOCK_XDR_PREFIX = 'mock-xdr:';

export const MOCK_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

interface MockVc {
  owner: string;
  status: VcStatus;
  since: string;
  vcData: string;
}

interface MockStore {
  dids: Map<string, DidRecord>;
  vcs: Map<string, MockVc>;
}

/*
 * Next.js hot-reloads modules on every edit. A module-level Map would drop the
 * DID you registered ten seconds ago and leave its attestations pointing at
 * nothing, so the store is pinned to the realm instead. The key is versioned:
 * change the shape, bump the number, and stale objects from an old bundle are
 * simply not found rather than read with the wrong fields.
 */
const STORE_KEY = Symbol.for('brk.identity.mock.v1');
const scope = globalThis as unknown as Record<symbol, MockStore | undefined>;

function store(): MockStore {
  return (scope[STORE_KEY] ??= { dids: new Map(), vcs: new Map() });
}

/** Drop every mocked DID and credential. Tests use it; nothing else should. */
export function resetMockIdentity(): void {
  scope[STORE_KEY] = undefined;
}

/** Flip a mocked credential to revoked, so the revoked path is reachable. */
export function revokeMockVc(vcId: string, at = new Date().toISOString()): boolean {
  const vc = store().vcs.get(vcId);
  if (!vc) return false;
  vc.status = 'revoked';
  vc.since = at;
  return true;
}

/** Mock only: stable across restarts. The live method mints random bytes. */
export function mockDidFor(controller: string, network: 'testnet' | 'mainnet' = 'testnet'): string {
  assertClassicAddress(controller);
  const raw = StrKey.decodeEd25519PublicKey(controller);
  return buildDid(network, encodeDidId(raw.subarray(0, DID_ID_BYTES)));
}

/*
 * `|` and not `:` — a did:stellar is itself colon-separated, so splitting a
 * marker on colons hands back `did` / `stellar` / `testnet` as three fields and
 * every registration fails as malformed. Neither a DID nor a `G…` address can
 * contain a pipe.
 */
const FIELD_SEPARATOR = '|';

function marker(kind: 'register' | 'issue', ...parts: string[]): string {
  return `${MOCK_XDR_PREFIX}${kind}${FIELD_SEPARATOR}${parts.join(FIELD_SEPARATOR)}`;
}

function readMarker(xdr: string, kind: 'register' | 'issue'): string[] {
  const prefix = `${MOCK_XDR_PREFIX}${kind}${FIELD_SEPARATOR}`;
  if (!xdr?.startsWith(prefix)) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      anchorId: 'acta',
      message: `Expected a mock ${kind} transaction. Mock mode never produces a signable XDR — submit the marker it handed you.`,
    });
  }
  return xdr.slice(prefix.length).split(FIELD_SEPARATOR);
}

export class MockIdentityApi implements IdentityApi {
  readonly mode = 'mock' as const;

  constructor(private readonly network: 'testnet' | 'mainnet' = 'testnet') {}

  async prepareDidRegistration(controller: string): Promise<PreparedTx> {
    const did = mockDidFor(controller, this.network);
    if (store().dids.has(did)) {
      throw new RampError({
        code: 'INVALID_ORDER_STATE',
        anchorId: 'acta',
        message: `${did} is already registered for this wallet.`,
      });
    }
    return {
      did,
      xdr: marker('register', did, controller),
      networkPassphrase: MOCK_NETWORK_PASSPHRASE,
    };
  }

  async submitDidTx(signedXdr: string): Promise<{ txId: string }> {
    const [did, controller] = readMarker(signedXdr, 'register');
    if (!did || !controller || !parseDid(did)) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: 'acta',
        message: 'Malformed mock registration transaction.',
      });
    }

    store().dids.set(did, {
      did,
      controller,
      authentication: [walletKeyToMultikey(controller)],
      version: 1,
      deactivated: false,
    });
    return { txId: `mock-tx-${did.slice(-8)}` };
  }

  async getDidRecord(did: string): Promise<DidRecord | null> {
    return store().dids.get(did) ?? null;
  }

  async prepareVcIssue(req: VcIssueRequest): Promise<PreparedTx> {
    store().vcs.set(req.vcId, {
      owner: req.owner,
      // Pending until submitted, so a prepare that is never signed does not
      // leave a credential that verifies.
      status: 'invalid',
      since: new Date().toISOString(),
      vcData: req.vcData,
    });
    return {
      xdr: marker('issue', req.vcId, req.owner),
      networkPassphrase: MOCK_NETWORK_PASSPHRASE,
    };
  }

  async submitVcIssue(signedXdr: string): Promise<{ txId: string }> {
    const [vcId] = readMarker(signedXdr, 'issue');
    const vc = vcId ? store().vcs.get(vcId) : undefined;
    if (!vcId || !vc) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: 'acta',
        message: 'Unknown mock credential — prepare it before submitting.',
      });
    }
    vc.status = 'valid';
    vc.since = new Date().toISOString();
    return { txId: `mock-tx-${vcId.slice(-8)}` };
  }

  async verifyVc(req: {
    owner: string;
    vcId: string;
  }): Promise<{ status: VcStatus; since?: string }> {
    const vc = store().vcs.get(req.vcId);
    if (!vc || vc.owner !== req.owner) return { status: 'unknown' };
    return { status: vc.status, since: vc.since };
  }
}
