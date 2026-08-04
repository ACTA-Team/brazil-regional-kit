import { NextResponse } from 'next/server';
import { annotateEligibility } from '@brk/identity-kit';
import type { AssetId, CountryCode, RampDirection } from '@brk/ramp-core';
import { readyAnchors } from '@/server/anchors';
import { errorResponse, publicQuote } from '@/server/http';
import { identity } from '@/server/identity';

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
 *
 * Pass `did` and every quote also says whether the user can execute it. The
 * annotation happens HERE and not in the router: `@brk/ramp-router` knows
 * nothing about identity, and an app that never installs `@brk/identity-kit`
 * gets exactly the response it got before. Everything below is best-effort —
 * quoting is the product, and identity must never be able to take it down.
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
    const { router, all } = await readyAnchors();

    const result = await router.route({
      sellAsset,
      buyAsset: (params.get('buy') as AssetId | null) ?? undefined,
      sellAmount,
      country: (params.get('country') as CountryCode | null) ?? undefined,
      direction: (params.get('direction') as RampDirection | null) ?? undefined,
      account: params.get('account') ?? undefined,
    });

    const quotes = await withEligibility(result.quotes.map(publicQuote), params.get('did'), all);

    return NextResponse.json({
      quotes,
      anchors: result.anchors,
      elapsedMs: result.elapsedMs,
      hasLiveQuote: result.hasLiveQuote,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Annotate, or hand back exactly what came in.
 *
 * `annotateEligibility` is already written not to reject, and this is the belt
 * to that pair of braces: whatever happens in the identity layer, the caller
 * still gets their prices. A quote with no `eligibility` field renders no chip,
 * which is the correct thing to show when we do not know.
 */
async function withEligibility<Q extends { anchorId: string }>(
  quotes: Q[],
  did: string | null,
  adapters: Awaited<ReturnType<typeof readyAnchors>>['all'],
) {
  if (!did || quotes.length === 0) return quotes;

  try {
    const { api, issuer } = identity();
    return await annotateEligibility(quotes, {
      api,
      issuerPublicKey: issuer.publicKey,
      did,
      // An anchor that cannot take an order has nothing to gate on onboarding.
      anchors: adapters.map((a) => {
        const caps = a.capabilities();
        return { anchorId: caps.id, requiresOnboarding: caps.features.orders };
      }),
    });
  } catch (e) {
    console.warn('[brk] eligibility annotation failed:', e instanceof Error ? e.message : e);
    return quotes;
  }
}
