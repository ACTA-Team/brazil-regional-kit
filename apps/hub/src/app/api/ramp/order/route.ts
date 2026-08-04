import { NextResponse } from 'next/server';
import { anchorById } from '@/server/anchors';
import { errorResponse, publicQuote, readJson } from '@/server/http';

export const dynamic = 'force-dynamic';

interface Body {
  anchorId: string;
  quoteId: string;
  account: string;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await readJson<Body>(request);
  } catch (e) {
    return errorResponse(e);
  }

  try {
    const adapter = anchorById(body.anchorId);
    const order = await adapter.createOrder({
      quoteId: body.quoteId,
      account: body.account,
    });
    return NextResponse.json({ order: publicQuote(order) });
  } catch (e) {
    return errorResponse(e, body.anchorId);
  }
}
