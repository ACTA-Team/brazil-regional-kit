import { NextResponse } from 'next/server';
import { BRL, MXN, USDC, isRampError } from '@brk/ramp-core';
import { PAYMENT_HEADER, createX402Guard } from '@brk/stablecoin-kit';
import { readyAnchors } from '@/server/anchors';

export const dynamic = 'force-dynamic';

const RESOURCE = '/api/premium-fx';

/**
 * A paid API endpoint, priced in a stablecoin.
 *
 * Deliberately a real product rather than a toy: it returns the best BRL and MXN
 * rates the router can find across every anchor. That is genuinely worth paying
 * for, and it is exactly the kind of thing an autonomous agent would buy — which
 * is what x402 exists for.
 *
 *   GET  /api/premium-fx                     → 402 with payment terms
 *   GET  /api/premium-fx  x-payment: <hash>  → 200 with the rates
 */
function guard() {
  return createX402Guard({
    /*
     * With no X402_PAY_TO configured this collects to USDC's own issuer, which
     * on Stellar means the payment is burned rather than banked. That is a
     * deliberate default: a zero-config clone can still demonstrate the whole
     * protocol without us shipping an account that quietly accrues other
     * people's testnet funds. Set X402_PAY_TO to actually collect.
     */
    payTo: process.env.X402_PAY_TO ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    asset: USDC,
    price: process.env.X402_PRICE ?? '0.10',
    description: 'Best cross-anchor FX rates for BRL and MXN.',
  });
}

export async function GET(request: Request) {
  const g = guard();
  const proof = request.headers.get(PAYMENT_HEADER);

  if (!proof) {
    // 402 is the whole point — machine-readable terms, not a login page.
    return NextResponse.json(g.challenge(RESOURCE), {
      status: 402,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  try {
    const payment = await g.verify(proof, RESOURCE);
    const { router } = await readyAnchors();

    const [brl, mxn] = await Promise.all([
      router.best({ sellAsset: USDC, buyAsset: BRL, sellAmount: '100' }),
      router.best({ sellAsset: USDC, buyAsset: MXN, sellAmount: '100', country: 'MX' }),
    ]);

    return NextResponse.json({
      paidWith: {
        txHash: payment.txHash,
        amount: payment.amount,
        from: payment.from,
        settledAt: payment.ledgerCloseTime,
      },
      rates: [brl, mxn].filter(Boolean).map((q) => ({
        pair: `USDC/${q!.buyAsset.split(':')[1]}`,
        rate: q!.price,
        anchor: q!.anchorName,
        mode: q!.mode,
        buyAmountPer100: q!.buyAmount,
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    // A bad or reused payment gets the terms again, not a dead end — the client
    // can pay correctly and retry.
    const message = isRampError(e) ? e.message : 'Payment could not be verified.';
    return NextResponse.json(g.challenge(RESOURCE, message), {
      status: 402,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
