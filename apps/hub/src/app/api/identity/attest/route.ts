import { NextResponse } from 'next/server';
import { issueAttestation } from '@brk/identity-kit';
import { RampError } from '@brk/ramp-core';
import { anchors } from '@/server/anchors';
import { errorResponse, readJson } from '@/server/http';
import { assertDid, identity, signWithIssuer } from '@/server/identity';

export const dynamic = 'force-dynamic';

/**
 * Attest that a DID completed onboarding with an anchor.
 *
 * **This is not portable KYC.** The anchor still performs its own; what the
 * credential removes is the blind re-discovery, so the router can say which
 * quotes are executable before the user picks one. The disclaimer travels
 * inside the credential itself, not only in our documentation.
 *
 * In a real deployment this route would run after the anchor confirms
 * onboarding — a webhook, or a completed SEP-24 interactive flow. Here it is
 * driven from the identity page, which is honest for a demo and clearly
 * labelled as such on screen.
 *
 * The user does not sign: the hub owns the vault and signs as issuer. The
 * credential id is derived from (anchor, DID), so attesting twice is the same
 * credential and the second call reports `alreadyIssued`.
 *
 *   POST /api/identity/attest  { "did": "did:stellar:...", "anchorId": "etherfuse" }
 *   → { vcId, txId, alreadyIssued, mode }
 */
export async function POST(request: Request) {
  try {
    const body = await readJson<{ did?: string; anchorId?: string }>(request);
    const did = assertDid(body.did);

    const adapter = anchors().all.find((a) => a.capabilities().id === body.anchorId);
    if (!adapter) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: 'acta',
        message: `Unknown anchor "${body.anchorId}".`,
      });
    }

    const caps = adapter.capabilities();
    if (!caps.features.orders) {
      // Nothing to attest: an anchor that only quotes has no order to gate on
      // onboarding, and a credential for it would imply a check nobody makes.
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: caps.id,
        message: `${caps.name} does not gate execution on onboarding, so there is nothing to attest.`,
      });
    }

    const { api, issuer, mode } = identity();
    const result = await issueAttestation(api, {
      subjectDid: did,
      anchorId: caps.id,
      anchorName: caps.name,
      issuer,
      signXdr: signWithIssuer,
    });

    return NextResponse.json({ ...result, mode });
  } catch (e) {
    return errorResponse(e, 'acta');
  }
}
