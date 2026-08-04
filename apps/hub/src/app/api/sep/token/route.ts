import { NextResponse } from 'next/server';
import { decodeJwtClaims } from '@brk/adapter-sep';
import { errorResponse, readJson } from '@/server/http';
import { sep10 } from '@/server/sep';

export const dynamic = 'force-dynamic';

interface Body {
  /** The challenge, signed by the user's wallet. */
  transaction: string;
}

/** SEP-10 step 2: trade the signed challenge for the anchor's JWT. */
export async function POST(request: Request) {
  try {
    const { transaction } = await readJson<Body>(request);
    if (!transaction) throw new Error('transaction is required.');

    const client = await sep10();
    const token = await client.token(transaction);

    return NextResponse.json({
      token,
      // Decoded for display only — the anchor verifies its own signature.
      claims: decodeJwtClaims(token),
    });
  } catch (e) {
    return errorResponse(e, 'testanchor');
  }
}
