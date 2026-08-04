import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/http';
import { assertDid, identity } from '@/server/identity';

export const dynamic = 'force-dynamic';

/**
 * Resolve a DID against the registry.
 *
 * "Not registered" answers 200 with `registered: false`, not 404. The identity
 * page asks this on every load to re-validate whatever the browser remembered,
 * and an unregistered DID is the ordinary answer for anyone who has not
 * registered one — an error banner would be wrong.
 *
 * The `controller` in the reply is what makes the browser's cache trustworthy:
 * a remembered DID is kept only if the wallet now connected controls it.
 *
 *   GET /api/identity/did/resolve?did=did:stellar:testnet:...
 *   → { registered, did, controller?, version?, deactivated?, authentication? }
 */
export async function GET(request: Request) {
  try {
    const did = assertDid(new URL(request.url).searchParams.get('did'));
    const record = await identity().api.getDidRecord(did);

    if (!record) return NextResponse.json({ registered: false, did });

    return NextResponse.json({
      registered: true,
      did: record.did,
      controller: record.controller,
      version: record.version,
      deactivated: record.deactivated,
      authentication: record.authentication,
    });
  } catch (e) {
    return errorResponse(e, 'acta');
  }
}
