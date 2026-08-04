import { NextResponse } from 'next/server';
import { verifyPocResponse, type PocChallenge } from '@brk/identity-kit';
import { RampError } from '@brk/ramp-core';
import { errorResponse, readJson } from '@/server/http';
import { assertDid, identity } from '@/server/identity';

export const dynamic = 'force-dynamic';

/**
 * Proof of control, step 2: check the signature.
 *
 * The keys come from the DID document the server resolves for itself, never
 * from the request. A caller who could supply the key list could supply their
 * own key, and the whole exercise would prove that they own a keypair.
 *
 * A failed verification is a 200 with `verified: false` and a reason. It is an
 * answer about a signature, not a server error, and the page shows the reason —
 * expired, replayed, wrong domain — because each one means something different
 * to whoever is trying to log in.
 *
 *   POST /api/identity/verify  { challenge, signature }
 *   → { verified, reason?, did, controller?, mode }
 */
export async function POST(request: Request) {
  try {
    const { challenge, signature } = await readJson<{
      challenge?: PocChallenge;
      signature?: string;
    }>(request);

    if (!challenge || !signature) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: 'acta',
        message: 'challenge and signature are required.',
      });
    }

    const did = assertDid(challenge.did);
    const { api, mode } = identity();
    const record = await api.getDidRecord(did);

    if (!record) {
      return NextResponse.json({ verified: false, reason: 'invalid-did', did, mode });
    }

    const result = verifyPocResponse({
      challenge,
      signature,
      authentication: record.authentication,
      expectedDomain: new URL(request.url).host,
      mode,
    });

    return NextResponse.json({
      ...result,
      did,
      // Only on success: naming the controller of a DID somebody failed to prove
      // control of would leak the answer to whoever was guessing.
      controller: result.verified ? record.controller : undefined,
      mode,
    });
  } catch (e) {
    return errorResponse(e, 'acta');
  }
}
