/**
 * Attestations.
 *
 * The load-bearing claim is that the credential id is DERIVED: eligibility has
 * no index and no database, it recomputes the id and asks the vault. If the
 * derivation ever stops being stable, or overflows ACTA's 64-character limit and
 * gets silently truncated, every attestation becomes unfindable and every user
 * reads as un-onboarded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RampError } from '@brk/ramp-core';
import { MockIdentityApi, resetMockIdentity } from './api/mock';
import type { IdentityApi, PreparedTx } from './api/api';
import {
  ANCHOR_ID_MAX_LENGTH,
  ATTESTATION_DISCLAIMER,
  attestationVcId,
  buildAttestationVc,
  issueAttestation,
  VC_CONTEXT_V2,
  VC_ID_MAX_LENGTH,
} from './attestation';

const SUBJECT = 'did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi';
const ISSUER = {
  publicKey: 'GISSUERWALLET',
  did: 'did:stellar:testnet:aaaaaaaaaaaaaaaaaaaaaaaaaa',
};

beforeEach(resetMockIdentity);

describe('attestationVcId', () => {
  it('derives a stable id from the DID and the anchor', () => {
    expect(attestationVcId(SUBJECT, 'etherfuse')).toBe('att-etherfuse-znfxngsh46vkyqu6inrx4omphi');
  });

  it('is the same every time, which is what makes the lookup indexless', () => {
    expect(attestationVcId(SUBJECT, 'etherfuse')).toBe(attestationVcId(SUBJECT, 'etherfuse'));
  });

  it('separates anchors', () => {
    expect(attestationVcId(SUBJECT, 'etherfuse')).not.toBe(attestationVcId(SUBJECT, 'anclap'));
  });

  it.each(['etherfuse', 'testanchor', 'anclap', 'manteca', 'koywe'])(
    'fits ACTA`s 64-character limit for the anchor id %s',
    (anchorId) => {
      expect(attestationVcId(SUBJECT, anchorId).length).toBeLessThanOrEqual(VC_ID_MAX_LENGTH);
    },
  );

  it('accepts an anchor id of exactly the maximum length', () => {
    const id = attestationVcId(SUBJECT, 'a'.repeat(ANCHOR_ID_MAX_LENGTH));
    expect(id).toHaveLength(VC_ID_MAX_LENGTH);
  });

  /*
   * Truncating instead of throwing would make two long anchor ids share one
   * credential — anchor A's attestation would grant eligibility on anchor B.
   */
  it('refuses an anchor id that would overflow, rather than trimming it', () => {
    expect(() => attestationVcId(SUBJECT, 'a'.repeat(ANCHOR_ID_MAX_LENGTH + 1))).toThrowError(
      new RegExp(`1–${ANCHOR_ID_MAX_LENGTH} characters`),
    );
  });

  it('refuses an empty anchor id', () => {
    expect(() => attestationVcId(SUBJECT, '')).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  });

  it('refuses anything that is not a did:stellar', () => {
    expect(() => attestationVcId('did:key:abc', 'etherfuse')).toThrowError(/Not a did:stellar/);
  });
});

describe('buildAttestationVc', () => {
  const vc = () =>
    JSON.parse(
      buildAttestationVc({
        subjectDid: SUBJECT,
        anchorId: 'etherfuse',
        anchorName: 'Etherfuse',
        issuerDid: ISSUER.did,
        issuedAt: '2026-01-01T00:00:00.000Z',
      }),
    );

  it('is a W3C VC 2.0 credential', () => {
    expect(vc()['@context']).toContain(VC_CONTEXT_V2);
    expect(vc().type).toEqual(['VerifiableCredential', 'AnchorOnboardingAttestation']);
  });

  it('identifies the holder through credentialSubject.id', () => {
    // There is no separate holder field in ACTA's payload; this is the only
    // place the subject appears.
    expect(vc().credentialSubject.id).toBe(SUBJECT);
  });

  it('names the issuing DID and the anchor', () => {
    expect(vc().issuer).toBe(ISSUER.did);
    expect(vc().credentialSubject.anchorId).toBe('etherfuse');
    expect(vc().credentialSubject.anchorName).toBe('Etherfuse');
  });

  it('carries the not-portable-KYC disclaimer inside the credential', () => {
    // So a reader who never sees our documentation still knows what this is.
    expect(vc().credentialSubject.disclaimer).toBe(ATTESTATION_DISCLAIMER);
  });

  it('honours an explicit issuance time', () => {
    expect(vc().validFrom).toBe('2026-01-01T00:00:00.000Z');
  });

  it('defaults the issuance time to now', () => {
    const built = JSON.parse(
      buildAttestationVc({ subjectDid: SUBJECT, anchorId: 'x', issuerDid: ISSUER.did }),
    );
    expect(Date.parse(built.validFrom)).not.toBeNaN();
  });

  it('stays well inside ACTA`s 10,000-character payload limit', () => {
    expect(
      buildAttestationVc({ subjectDid: SUBJECT, anchorId: 'etherfuse', issuerDid: ISSUER.did })
        .length,
    ).toBeLessThan(10_000);
  });

  it('refuses a subject that is not a did:stellar', () => {
    expect(() =>
      buildAttestationVc({ subjectDid: 'GABC', anchorId: 'x', issuerDid: ISSUER.did }),
    ).toThrowError(/must be a did:stellar/);
  });
});

describe('issueAttestation', () => {
  const signXdr = (prepared: PreparedTx) => Promise.resolve(prepared.xdr);

  const request = {
    subjectDid: SUBJECT,
    anchorId: 'etherfuse',
    anchorName: 'Etherfuse',
    issuer: ISSUER,
    signXdr,
  };

  it('prepares, signs and submits, then reports the credential id', async () => {
    const api = new MockIdentityApi();
    const result = await issueAttestation(api, request);

    expect(result).toMatchObject({
      vcId: 'att-etherfuse-znfxngsh46vkyqu6inrx4omphi',
      mode: 'mock',
      alreadyIssued: false,
    });
    expect(result.txId).toBeTruthy();
  });

  it('leaves a credential the vault reports as valid', async () => {
    const api = new MockIdentityApi();
    const { vcId } = await issueAttestation(api, request);

    await expect(api.verifyVc({ owner: ISSUER.publicKey, vcId })).resolves.toMatchObject({
      status: 'valid',
    });
  });

  /*
   * The hub's wallet is the vault owner, the signing issuer and the transaction
   * source. ACTA binds a non-admin key to one wallet and rejects any other
   * owner, so getting this wrong is a 403 that reads like a bad key.
   */
  it('uses the issuer wallet as owner, issuer and source', async () => {
    const prepareVcIssue = vi.fn(async () => ({ xdr: 'X', networkPassphrase: 'P' }));
    const api = {
      mode: 'live',
      prepareVcIssue,
      submitVcIssue: async () => ({ txId: 'tx' }),
    } as unknown as IdentityApi;

    await issueAttestation(api, request);

    expect(prepareVcIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: ISSUER.publicKey,
        issuer: ISSUER.publicKey,
        sourcePublicKey: ISSUER.publicKey,
        issuerDid: ISSUER.did,
      }),
    );
  });

  it('hands the prepared transaction to the signer and submits what comes back', async () => {
    const submitVcIssue = vi.fn(async () => ({ txId: 'tx' }));
    const api = {
      mode: 'live',
      prepareVcIssue: async () => ({ xdr: 'UNSIGNED', networkPassphrase: 'P' }),
      submitVcIssue,
    } as unknown as IdentityApi;

    await issueAttestation(api, { ...request, signXdr: async (p) => `SIGNED:${p.xdr}` });

    expect(submitVcIssue).toHaveBeenCalledWith('SIGNED:UNSIGNED');
  });

  it('is idempotent: a conflict on an already-valid credential is success', async () => {
    // The id is derived, so attesting twice is the same credential. Failing the
    // second attempt would make a retry look like a broken integration.
    const api = {
      mode: 'live',
      prepareVcIssue: async () => {
        throw new RampError({ code: 'INVALID_ORDER_STATE', message: 'already exists' });
      },
      verifyVc: async () => ({ status: 'valid' as const }),
    } as unknown as IdentityApi;

    await expect(issueAttestation(api, request)).resolves.toMatchObject({
      alreadyIssued: true,
      txId: '',
    });
  });

  it('does not swallow a state error that is not an existing valid credential', async () => {
    // We confirm with the vault rather than assuming. A conflict for any other
    // reason has to keep failing.
    const api = {
      mode: 'live',
      prepareVcIssue: async () => {
        throw new RampError({ code: 'INVALID_ORDER_STATE', message: 'vault is frozen' });
      },
      verifyVc: async () => ({ status: 'revoked' as const }),
    } as unknown as IdentityApi;

    await expect(issueAttestation(api, request)).rejects.toThrow(/vault is frozen/);
  });

  it('propagates an auth failure untouched', async () => {
    const api = {
      mode: 'live',
      prepareVcIssue: async () => {
        throw new RampError({ code: 'AUTH_FAILED', message: 'bad key' });
      },
    } as unknown as IdentityApi;

    await expect(issueAttestation(api, request)).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_FAILED' }),
    );
  });

  it('refuses before any network call when the subject is not a DID', async () => {
    const prepareVcIssue = vi.fn();
    const api = { mode: 'live', prepareVcIssue } as unknown as IdentityApi;

    await expect(issueAttestation(api, { ...request, subjectDid: 'GABC' })).rejects.toThrow(
      /Not a did:stellar/,
    );
    expect(prepareVcIssue).not.toHaveBeenCalled();
  });
});
