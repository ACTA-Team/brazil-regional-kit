import { NextResponse } from 'next/server';
import { Sep38Client } from '@brk/adapter-sep';
import { RampError, type AssetId } from '@brk/ramp-core';
import { readyAnchors } from '@/lib/anchors';
import { errorResponse, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

interface Body {
  jwt: string;
  sellAsset: AssetId;
  buyAsset: AssetId;
  sellAmount: string;
}

/**
 * SEP-38 `POST /quote` — a *firm* quote.
 *
 * This is the one SEP-38 endpoint that needs authentication, and the difference
 * is not cosmetic: `/price` is indicative and can move under you, while a firm
 * quote is reserved by the anchor with an id and a real expiry you can execute
 * against. Getting one is the payoff for the whole SEP-10 handshake.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = await readJson<Body>(request);
  } catch (e) {
    return errorResponse(e);
  }

  try {
    if (!body.jwt) {
      throw new RampError({
        code: 'AUTH_FAILED',
        anchorId: 'testanchor',
        message: 'A SEP-10 token is required for a firm quote. Authenticate first.',
      });
    }

    const { sep } = await readyAnchors();
    const { toml, info } = await sep.metadata();

    if (!toml.ANCHOR_QUOTE_SERVER) {
      throw new RampError({
        code: 'UNSUPPORTED_PAIR',
        anchorId: 'testanchor',
        message: 'The anchor advertises no SEP-38 quote server.',
      });
    }

    const client = new Sep38Client({ quoteServer: toml.ANCHOR_QUOTE_SERVER });

    // Delivery methods are mandatory on the fiat side for most anchors, and the
    // anchor itself tells us which ones it accepts.
    const sellInfo = info.assets.find((a) => a.asset === body.sellAsset);
    const buyInfo = info.assets.find((a) => a.asset === body.buyAsset);

    const quote = await client.firmQuote({
      jwt: body.jwt,
      sellAsset: body.sellAsset,
      buyAsset: body.buyAsset,
      sellAmount: body.sellAmount,
      context: 'sep6',
      sellDeliveryMethod: sellInfo?.sell_delivery_methods?.[0]?.name,
      buyDeliveryMethod: buyInfo?.buy_delivery_methods?.[0]?.name,
      countryCode: sellInfo?.country_codes?.[0] ?? buyInfo?.country_codes?.[0],
    });

    return NextResponse.json({ quote });
  } catch (e) {
    return errorResponse(e, 'testanchor');
  }
}
