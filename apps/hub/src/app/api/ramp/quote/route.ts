import { NextResponse } from 'next/server';
import type { AssetId, CountryCode } from '@brk/ramp-core';
import { anchorById } from '@/lib/anchors';
import { errorResponse, publicQuote, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

interface Body {
  anchorId: string;
  sellAsset: AssetId;
  buyAsset: AssetId;
  sellAmount: string;
  account?: string;
  country?: CountryCode;
}

/** Single-anchor quote. The fan-out across every anchor lives in /api/quotes. */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = await readJson<Body>(request);
  } catch (e) {
    return errorResponse(e);
  }

  try {
    const adapter = anchorById(body.anchorId);
    const quote = await adapter.getQuote({
      sellAsset: body.sellAsset,
      buyAsset: body.buyAsset,
      sellAmount: body.sellAmount,
      account: body.account,
      country: body.country,
    });
    return NextResponse.json({ quote: publicQuote(quote) });
  } catch (e) {
    return errorResponse(e, body.anchorId);
  }
}
