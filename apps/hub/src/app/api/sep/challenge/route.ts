import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/http';
import { sep10 } from '@/server/sep';

export const dynamic = 'force-dynamic';

/**
 * SEP-10 step 1. Returns a challenge that has ALREADY been verified server-side
 * — correct server signing key, sequence 0, matching home and web-auth domains,
 * issued for the requested account. An unverified challenge never leaves here.
 */
export async function GET(request: Request) {
  const account = new URL(request.url).searchParams.get('account');

  if (!account?.startsWith('G')) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'A classic G… account is required.' } },
      { status: 400 },
    );
  }

  try {
    const client = await sep10();
    const challenge = await client.challenge(account);
    return NextResponse.json({
      transaction: challenge.transaction,
      networkPassphrase: challenge.networkPassphrase,
      clientAccountId: challenge.clientAccountId,
      verified: true,
    });
  } catch (e) {
    return errorResponse(e, 'testanchor');
  }
}
