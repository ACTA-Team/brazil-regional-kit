import { NextResponse } from 'next/server';
import { RampError, type AssetId, assetCode } from '@brk/ramp-core';
import { readyAnchors } from '@/lib/anchors';
import { errorResponse, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

interface Body {
  jwt: string;
  asset: AssetId;
  account: string;
  direction: 'deposit' | 'withdraw';
}

/**
 * SEP-24 interactive deposit/withdraw.
 *
 * The anchor returns a URL that the app opens in a popup; the anchor owns the
 * KYC and payment UI inside it, and the app polls the returned transaction id
 * for the outcome. It is the opposite trade-off to the Etherfuse integration —
 * far less control over the experience, but no bespoke API to learn, and it
 * works identically against every SEP-24 anchor in the ecosystem.
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
        message: 'SEP-24 needs a SEP-10 token. Authenticate first.',
      });
    }

    const { sep } = await readyAnchors();
    const { toml } = await sep.metadata();
    const server = toml.TRANSFER_SERVER_SEP0024;

    if (!server) {
      throw new RampError({
        code: 'UNSUPPORTED_PAIR',
        anchorId: 'testanchor',
        message: 'The anchor advertises no SEP-24 transfer server.',
      });
    }

    const response = await fetch(
      `${server.replace(/\/+$/, '')}/transactions/${body.direction}/interactive`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${body.jwt}`,
        },
        body: JSON.stringify({
          asset_code: assetCode(body.asset),
          account: body.account,
        }),
      },
    );

    const text = await response.text();
    let payload: { url?: string; id?: string; type?: string; error?: string };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      throw new RampError({
        code: 'ANCHOR_UNAVAILABLE',
        anchorId: 'testanchor',
        message: `SEP-24 returned ${response.status} with a non-JSON body.`,
        status: response.status,
      });
    }

    if (!response.ok || !payload.url) {
      throw new RampError({
        code: response.status === 403 ? 'KYC_REQUIRED' : 'INVALID_REQUEST',
        anchorId: 'testanchor',
        message: payload.error ?? `SEP-24 returned ${response.status}.`,
        status: response.status,
        raw: payload,
      });
    }

    return NextResponse.json({ url: payload.url, id: payload.id, type: payload.type });
  } catch (e) {
    return errorResponse(e, 'testanchor');
  }
}
