import { NextResponse } from 'next/server';
import { identity } from '@/server/identity';
import { errorResponse } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * What the identity layer is, right now.
 *
 * Same reflex as `GET /api/anchors`: the claim on screen is served from the code
 * that does the work, so the badge cannot drift from reality. If this says
 * `mock`, nothing on the identity page touched a chain or a credential.
 *
 *   GET /api/identity/status
 */
export async function GET() {
  try {
    const { mode, issuer, resolverUrl } = identity();
    return NextResponse.json({
      mode,
      // Anyone can resolve this and see who signs the attestations.
      issuerDid: mode === 'live' ? issuer.did : null,
      resolverUrl,
    });
  } catch (e) {
    return errorResponse(e, 'acta');
  }
}
