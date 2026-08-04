import { NextResponse } from 'next/server';
import type { AssetId, CountryCode, RampDirection } from '@brk/ramp-core';
import { readyAnchors } from '@/server/anchors';
import { errorResponse, publicQuote } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * The multi-anchor endpoint.
 *
 * One request in, every anchor that serves the corridor out — with the ones
 * that could not help reported alongside the ones that could. This is the whole
 * "one API, many anchors" claim in a single route:
 *
 *   GET /api/quotes?sell=iso4217:BRL&amount=500&country=BR
 *   GET /api/quotes?sell=stellar:USDC:GBBD...&buy=iso4217:USD&amount=100
 *
 * Omit `buy` to ask the open question — "what can I get for this, here?" — and
 * the router answers across every destination asset it can reach.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const sellAsset = params.get('sell') as AssetId | null;
  const sellAmount = params.get('amount');

  if (!sellAsset || !sellAmount) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'sell and amount are required.' } },
      { status: 400 },
    );
  }

  try {
    const { router } = await readyAnchors();

    const result = await router.route({
      sellAsset,
      buyAsset: (params.get('buy') as AssetId | null) ?? undefined,
      sellAmount,
      country: (params.get('country') as CountryCode | null) ?? undefined,
      direction: (params.get('direction') as RampDirection | null) ?? undefined,
      account: params.get('account') ?? undefined,
    });

    return NextResponse.json({
      quotes: result.quotes.map(publicQuote),
      anchors: result.anchors,
      elapsedMs: result.elapsedMs,
      hasLiveQuote: result.hasLiveQuote,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
