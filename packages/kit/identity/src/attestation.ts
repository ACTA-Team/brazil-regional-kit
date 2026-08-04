/**
 * Onboarding attestations.
 *
 * **What this is not: portable KYC.** No anchor accepts another anchor's KYC —
 * the obligation is per institution, and a credential cannot transfer it. What
 * an attestation removes is the blind re-discovery: the user finds out which
 * anchors they can already execute against before they pick one, instead of
 * after a payment fails with `KYC_REQUIRED`.
 *
 * Two decisions worth knowing before you change anything here:
 *
 * **The credential lives in the issuer's vault, not the user's.** ACTA binds a
 * non-admin API key to one wallet and requires the vault `owner` to be that
 * wallet. Issuing into each user's own vault would mean deploying a vault per
 * user and holding an admin key. The subject is still the user's DID —
 * `credentialSubject.id` — so the credential is about them either way.
 *
 * **The credential id is derived, not stored.** `att-<anchorId>-<didId>` can be
 * recomputed by anyone holding the DID, so eligibility needs no index, no
 * database and no lookup table: to ask "is this DID attested for Etherfuse?" you
 * compute the id and ask the vault. It also makes issuance naturally idempotent.
 */

import { RampError } from '@brk/ramp-core';
import { parseDid } from './did/did';
import type { IdentityApi, IdentityMode, PreparedTx } from './api/api';

/** ACTA caps `vcId` at 64 characters and `vcData` at 10,000. */
export const VC_ID_MAX_LENGTH = 64;
export const VC_DATA_MAX_LENGTH = 10_000;

export const ATTESTATION_TYPE = 'AnchorOnboardingAttestation';
export const VC_CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2';

/**
 * Travels inside the credential itself, so the limit is not something a reader
 * has to find in our documentation to know what they are looking at.
 */
export const ATTESTATION_DISCLAIMER =
  'The anchor performs its own KYC. This attests that onboarding with this anchor was completed for this DID; it is not transferable KYC and no other anchor should treat it as such.';

/**
 * `att-` + anchorId + `-` + the 26-character DID id.
 *
 * The 33-character ceiling on an anchor id is what is left of ACTA's 64. Every
 * anchor in the kit is well under it, but a truncated id would silently collide
 * with another anchor's credential, so this throws rather than trimming.
 */
export const ANCHOR_ID_MAX_LENGTH = VC_ID_MAX_LENGTH - 'att-'.length - 1 - 26;

export function attestationVcId(did: string, anchorId: string): string {
  const parsed = parseDid(did);
  if (!parsed) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: `Not a did:stellar: ${did}`,
    });
  }
  if (!anchorId || anchorId.length > ANCHOR_ID_MAX_LENGTH) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: `Anchor id must be 1–${ANCHOR_ID_MAX_LENGTH} characters to fit a credential id, got ${anchorId.length}.`,
    });
  }
  return `att-${anchorId}-${parsed.id}`;
}

export interface AttestationInput {
  subjectDid: string;
  anchorId: string;
  /** The DID doing the attesting — the hub's, not the anchor's. */
  issuerDid: string;
  /** Human-readable anchor name, for anyone reading the credential directly. */
  anchorName?: string;
  issuedAt?: string;
}

/** A W3C Verifiable Credentials 2.0 payload, as the JSON string ACTA stores. */
export function buildAttestationVc(input: AttestationInput): string {
  if (!parseDid(input.subjectDid)) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: `Credential subject must be a did:stellar, got ${input.subjectDid}`,
    });
  }

  const vcData = JSON.stringify({
    '@context': [VC_CONTEXT_V2],
    type: ['VerifiableCredential', ATTESTATION_TYPE],
    issuer: input.issuerDid,
    validFrom: input.issuedAt ?? new Date().toISOString(),
    credentialSubject: {
      // The holder is identified here and nowhere else — there is no separate
      // holder field in ACTA's payload.
      id: input.subjectDid,
      anchorId: input.anchorId,
      anchorName: input.anchorName,
      attestation: 'onboarding-completed',
      disclaimer: ATTESTATION_DISCLAIMER,
    },
  });

  if (vcData.length > VC_DATA_MAX_LENGTH) {
    throw new RampError({
      code: 'INVALID_REQUEST',
      message: `Credential payload is ${vcData.length} characters, over ACTA's ${VC_DATA_MAX_LENGTH} limit.`,
    });
  }
  return vcData;
}

export interface AttestationIssuer {
  /** The vault owner and signing account — the wallet bound to the API key. */
  publicKey: string;
  /** Its registered did:stellar. Its on-chain controller must be `publicKey`. */
  did: string;
}

export interface IssueAttestationRequest extends Omit<AttestationInput, 'issuerDid'> {
  issuer: AttestationIssuer;
  /** Whatever holds the issuer key — a server-side keypair, never the browser. */
  signXdr: (prepared: PreparedTx) => Promise<string>;
}

export interface IssueAttestationResult {
  vcId: string;
  txId: string;
  mode: IdentityMode;
  /** True when the credential already existed and nothing new was written. */
  alreadyIssued: boolean;
}

export async function issueAttestation(
  api: IdentityApi,
  req: IssueAttestationRequest,
): Promise<IssueAttestationResult> {
  const vcId = attestationVcId(req.subjectDid, req.anchorId);
  const vcData = buildAttestationVc({ ...req, issuerDid: req.issuer.did });

  try {
    const prepared = await api.prepareVcIssue({
      // owner, issuer and sourcePublicKey are all the hub's wallet: it owns the
      // vault, signs the transaction and pays the on-chain issuance fee.
      owner: req.issuer.publicKey,
      issuer: req.issuer.publicKey,
      sourcePublicKey: req.issuer.publicKey,
      issuerDid: req.issuer.did,
      vcId,
      vcData,
    });

    const { txId } = await api.submitVcIssue(await req.signXdr(prepared));
    return { vcId, txId, mode: api.mode, alreadyIssued: false };
  } catch (e) {
    /*
     * The credential id is derived, so attesting the same DID for the same
     * anchor twice is the same credential — a conflict means the work is
     * already done. We confirm that with the vault rather than assuming it: an
     * `INVALID_ORDER_STATE` that is not an existing valid credential is a real
     * failure and has to keep failing.
     */
    if (e instanceof RampError && e.code === 'INVALID_ORDER_STATE') {
      const existing = await api.verifyVc({ owner: req.issuer.publicKey, vcId });
      if (existing.status === 'valid') {
        return { vcId, txId: '', mode: api.mode, alreadyIssued: true };
      }
    }
    throw e;
  }
}
