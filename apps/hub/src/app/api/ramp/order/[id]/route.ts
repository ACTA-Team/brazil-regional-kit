import { NextResponse } from 'next/server';
import { anchorById } from '@/lib/anchors';
import { errorResponse, publicQuote } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Polled by the order stepper until the status is terminal. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const anchorId = new URL(request.url).searchParams.get('anchorId') ?? 'etherfuse';

  try {
    const order = await anchorById(anchorId).getOrder(id);
    return NextResponse.json({ order: publicQuote(order) });
  } catch (e) {
    return errorResponse(e, anchorId);
  }
}
