import { NextResponse } from 'next/server';
import { readyAnchors } from '@/server/anchors';
import { errorResponse } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * The anchor status matrix, served from the running system rather than written
 * by hand in a README. If an anchor is in mock mode, this says so — which means
 * the claim on screen cannot drift from what the code is actually doing.
 */
export async function GET() {
  try {
    const { router } = await readyAnchors();
    return NextResponse.json({ anchors: router.capabilities() });
  } catch (e) {
    return errorResponse(e);
  }
}
