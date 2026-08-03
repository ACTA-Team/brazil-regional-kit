import { NextResponse } from 'next/server';
import { submitTransaction } from '@brk/stablecoin-kit';
import { errorResponse, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

interface Body {
  signedXdr: string;
}

/**
 * Submit a Freighter-signed transaction.
 *
 * Server-side on purpose: it keeps Horizon's error decoding, retries and
 * network configuration in one place instead of scattered across every page
 * that happens to need a signature.
 */
export async function POST(request: Request) {
  try {
    const { signedXdr } = await readJson<Body>(request);
    if (!signedXdr) throw new Error('signedXdr is required.');

    const result = await submitTransaction(signedXdr);
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
