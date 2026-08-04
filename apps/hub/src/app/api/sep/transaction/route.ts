import { NextResponse } from 'next/server';
import { RampError } from '@brk/ramp-core';
import { readyAnchors } from '@/server/anchors';
import { errorResponse, readJson } from '@/server/http';

export const dynamic = 'force-dynamic';

interface Body {
  jwt: string;
  id: string;
}

/**
 * The state of a SEP-24 transaction, straight from the anchor.
 *
 * Exists because the interactive popup is the anchor's UI, not ours, and the
 * SDF reference anchor drops the user on a status screen where every field is
 * blank. That blankness is accurate — a freshly created transaction really is
 * `incomplete` with no amounts until its form is filled — but from the outside
 * it is indistinguishable from a broken integration.
 *
 * Reading the transaction back gives the app something it can show on its own
 * authority: this id exists, the anchor knows it, and here is what it says
 * about it right now.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = await readJson<Body>(request);
  } catch (e) {
    return errorResponse(e);
  }

  try {
    if (!body.jwt || !body.id) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: 'testanchor',
        message: 'A SEP-10 token and a transaction id are both required.',
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
      `${server.replace(/\/+$/, '')}/transaction?id=${encodeURIComponent(body.id)}`,
      { headers: { Authorization: `Bearer ${body.jwt}` } },
    );

    const text = await response.text();
    let payload: { transaction?: Record<string, unknown>; error?: string };
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

    if (!response.ok) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: 'testanchor',
        message: payload.error ?? `SEP-24 returned ${response.status}.`,
        status: response.status,
      });
    }

    const tx = (payload.transaction ?? payload) as Record<string, unknown>;

    return NextResponse.json({
      id: tx.id,
      kind: tx.kind,
      status: tx.status,
      amountIn: tx.amount_in ?? null,
      amountOut: tx.amount_out ?? null,
      // The anchor's own page for this transaction, so the claim is checkable
      // on the anchor's domain rather than only in our UI.
      moreInfoUrl: tx.more_info_url ?? null,
    });
  } catch (e) {
    return errorResponse(e, 'testanchor');
  }
}
