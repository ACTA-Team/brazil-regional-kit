import { NextResponse } from 'next/server';
import { RampError } from '@brk/ramp-core';
import { anchorById } from '@/server/anchors';
import { errorResponse, publicQuote, readJson } from '@/server/http';

export const dynamic = 'force-dynamic';

interface Body {
  anchorId?: string;
  /** `fiat` = the customer paid the PIX; `crypto` = the burn transaction landed. */
  leg: 'fiat' | 'crypto';
}

/**
 * Sandbox settlement hook.
 *
 * Etherfuse's sandbox does not advance orders on its own — nothing happens until
 * you tell it the fiat or crypto leg arrived. That is normally a nuisance; in a
 * demo it is a gift, because "Simulate PIX payment" is a button a judge can press.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: Body;
  try {
    body = await readJson<Body>(request);
  } catch (e) {
    return errorResponse(e);
  }

  const anchorId = body.anchorId ?? 'etherfuse';

  try {
    const adapter = anchorById(anchorId);
    const simulate =
      body.leg === 'fiat' ? adapter.simulateFiatReceived : adapter.simulateCryptoReceived;

    if (!simulate) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId,
        message: `${anchorId} does not expose sandbox settlement hooks.`,
      });
    }

    const order = await simulate.call(adapter, id);
    return NextResponse.json({ order: publicQuote(order) });
  } catch (e) {
    return errorResponse(e, anchorId);
  }
}
