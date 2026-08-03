/**
 * The on-chain half of an off-ramp.
 *
 * Anchors split into two camps here, and an integration has to handle both:
 *
 *   - Some hand back a ready-made unsigned transaction (Etherfuse's
 *     `burnTransaction`). Sign it as-is; the anchor chose the memo and the
 *     destination and will reconcile against exactly that.
 *   - Some just tell you where to send the asset (SEP-6/SEP-24 give an address
 *     and a memo). The client has to build the payment itself.
 *
 * `resolveReturnTransaction` collapses that into one call, so the off-ramp page
 * does not branch on which kind of anchor it is talking to.
 */

import { RampError, type Order } from '@brk/ramp-core';
import { buildPaymentTx, type NetworkConfig, TESTNET } from './horizon';

export interface ReturnTransaction {
  xdr: string;
  /**
   * `anchor` — the anchor built it, sign verbatim.
   * `kit` — we built a payment to the anchor's account.
   */
  origin: 'anchor' | 'kit';
}

export async function resolveReturnTransaction(
  order: Order,
  fromAddress: string,
  config: NetworkConfig = TESTNET,
): Promise<ReturnTransaction> {
  if (order.direction !== 'offramp') {
    throw new RampError({
      code: 'INVALID_ORDER_STATE',
      anchorId: order.anchorId,
      message: 'Only an off-ramp order has a return transaction.',
    });
  }

  if (order.unsignedTxXdr) {
    return { xdr: order.unsignedTxXdr, origin: 'anchor' };
  }

  if (order.anchorAccount) {
    const xdr = await buildPaymentTx(
      {
        from: fromAddress,
        to: order.anchorAccount,
        asset: order.sellAsset,
        amount: order.sellAmount,
        // Anchors reconcile on this. `validateMemo` inside buildPaymentTx
        // rejects anything over 28 bytes rather than letting it truncate.
        memo: order.anchorMemo ?? order.id.replace(/-/g, '').slice(0, 24),
      },
      config,
    );
    return { xdr, origin: 'kit' };
  }

  throw new RampError({
    code: 'INVALID_ORDER_STATE',
    anchorId: order.anchorId,
    message:
      `${order.anchorName} gave neither a signed-ready transaction nor a destination account. ` +
      `Nothing can be returned to the anchor for order ${order.id}.`,
  });
}
