import { NextResponse } from 'next/server';
import { errorResponse, readJson } from '@/server/http';
import { assertDid, identity } from '@/server/identity';

export const dynamic = 'force-dynamic';

/**
 * Step 2: submit what the wallet signed.
 *
 * The DID comes back in the response because the browser needs to remember it,
 * and because there is no way to look it up later: the registry is keyed by
 * DID, not by controller, so nothing anywhere can answer "which DID does this
 * wallet control?". See `docs/identity.md`.
 *
 *   POST /api/identity/did/submit  { "signedXdr": "...", "did": "did:stellar:..." }
 *   → { txId, did, mode }
 */
export async function POST(request: Request) {
  try {
    const { signedXdr, did } = await readJson<{ signedXdr?: string; did?: string }>(request);

    if (!signedXdr) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'signedXdr is required.' } },
        { status: 400 },
      );
    }

    const { api, mode } = identity();
    const { txId } = await api.submitDidTx(signedXdr);

    return NextResponse.json({ txId, did: assertDid(did), mode });
  } catch (e) {
    return errorResponse(e, 'acta');
  }
}
