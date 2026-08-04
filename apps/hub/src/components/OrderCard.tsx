'use client';

import type { PublicOrder } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ModeBadge } from './ModeBadge';
import { OrderStepper } from './OrderStepper';

/**
 * A live order, presented the same way on both ramps.
 *
 * The header carries the two things that make the order checkable rather than
 * merely claimed: the mode badge, and a link to the anchor's own hosted page
 * for this exact id. Someone who does not believe the demo can open that link
 * and see the same order on the anchor's domain — which is a far stronger
 * argument than any wording in the UI.
 */
export function OrderCard({ order }: { order: PublicOrder }) {
  const { t } = useI18n();

  return (
    <section className="card-cutout animate-pop overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-6 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{order.anchorName}</span>
          <ModeBadge mode={order.mode} />
        </div>
        <div className="flex items-center gap-3">
          {order.anchorPage ? (
            <a
              href={order.anchorPage}
              target="_blank"
              rel="noreferrer"
              className="btn-link text-xs"
            >
              {t('onramp.viewOnAnchor')}
            </a>
          ) : null}
          <span className="font-mono text-xs text-fg-subtle">{order.id?.slice(0, 8) ?? '—'}</span>
        </div>
      </header>

      <div className="px-6 py-6">
        <OrderStepper direction={order.direction} status={order.status} />
      </div>
    </section>
  );
}
