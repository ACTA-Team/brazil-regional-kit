import { NextResponse } from 'next/server';
import { createPocChallenge } from '@brk/identity-kit';
import { errorResponse } from '@/server/http';
import { assertDid, identity } from '@/server/identity';

export const dynamic = 'force-dynamic';

/**
 * Proof of control, step 1: a challenge to sign.
 *
 * The domain is taken from the request, not from configuration, and it is
 * checked again at verification. That is what stops a signature collected by
 * another site from being replayed here — a challenge that named no site, or
 * named one nobody checks, would be worth exactly nothing.
 *
 *   GET /api/identity/challenge?did=did:stellar:testnet:...
 *   → { challenge: { did, domain, nonce, timestamp }, mode }
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const did = assertDid(url.searchParams.get('did'));

    return NextResponse.json({
      challenge: createPocChallenge({ did, domain: url.host }),
      mode: identity().mode,
    });
  } catch (e) {
    return errorResponse(e, 'acta');
  }
}
