import { NextResponse } from 'next/server';
import { errorResponse, readJson } from '@/server/http';
import { assertControllerAddress, assertSignableRegistration, identity } from '@/server/identity';

export const dynamic = 'force-dynamic';

/**
 * Step 1 of registering a DID: an unsigned transaction, already sanity-checked.
 *
 * The wallet signs whatever we hand it, so what we hand it is checked first —
 * the same posture as the SEP-10 route next door. `assertSignableRegistration`
 * documents exactly what is and is not verifiable here; an XDR that fails any
 * of it never reaches the browser.
 *
 *   POST /api/identity/did/prepare  { "address": "G..." }
 *   → { did, xdr, networkPassphrase, mode }
 */
export async function POST(request: Request) {
  try {
    const { address } = await readJson<{ address?: string }>(request);
    const controller = assertControllerAddress(address);

    const { api, mode } = identity();
    const prepared = await api.prepareDidRegistration(controller);

    // Mock mode hands back a marker, not a transaction — there is nothing to
    // parse and nothing to sign, which is the honest shape of "nothing happened".
    if (mode === 'live') assertSignableRegistration(prepared, controller);

    return NextResponse.json({
      did: prepared.did,
      xdr: prepared.xdr,
      networkPassphrase: prepared.networkPassphrase,
      mode,
    });
  } catch (e) {
    return errorResponse(e, 'acta');
  }
}
