import { NextResponse } from 'next/server';
import { BRL, USD, multiply, type AssetId } from '@brk/ramp-core';
import { quoteSwap } from '@brk/stablecoin-kit';
import { readyAnchors } from '@/lib/anchors';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Fiat currencies to try as a bridge when the order books have no direct path. */
const BRIDGES: AssetId[] = [BRL, USD];

/**
 * Price a swap, preferring the real order books.
 *
 * When no path exists, rather than inventing a rate we ask the router to
 * compose one: if some anchor prices TESOURO→BRL and another prices BRL→USDC,
 * multiplying them gives a defensible cross-rate — and the response says
 * exactly which anchors it was built from. That is a real use for having
 * several anchors behind one interface, not just a nicer comparison table.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sellAsset = params.get('sell') as AssetId | null;
  const buyAsset = params.get('buy') as AssetId | null;
  const sellAmount = params.get('amount');

  if (!sellAsset || !buyAsset || !sellAmount) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'sell, buy and amount are required.' } },
      { status: 400 },
    );
  }

  try {
    const reference = await composeCrossRate(sellAsset, buyAsset, sellAmount);

    const quote = await quoteSwap({
      sellAsset,
      buyAsset,
      sellAmount,
      slippageBps: Number(params.get('slippageBps') ?? '100'),
      referencePrice: reference?.price,
      referenceLabel: reference?.label,
    });

    return NextResponse.json({ quote });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Multiply two anchor quotes through a shared fiat leg. Returns null when no
 * bridge works, in which case an unroutable pair is reported as an error rather
 * than given a number nobody can justify.
 */
async function composeCrossRate(
  sellAsset: AssetId,
  buyAsset: AssetId,
  sellAmount: string,
): Promise<{ price: string; label: string } | null> {
  const { router } = await readyAnchors();

  for (const bridge of BRIDGES) {
    try {
      const first = await router.best({ sellAsset, buyAsset: bridge, sellAmount });
      if (!first) continue;

      const second = await router.best({
        sellAsset: bridge,
        buyAsset,
        sellAmount: first.buyAmount,
      });
      if (!second) continue;

      // (bridge per sell) × (buy per bridge) = buy per sell
      const price = multiply(first.price, second.price);
      return {
        price,
        label: `via ${bridge.split(':')[1]} using ${first.anchorName} → ${second.anchorName}`,
      };
    } catch {
      // This bridge does not work; try the next one.
    }
  }

  return null;
}
