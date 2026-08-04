'use client';

import type { OrderStatus, RampDirection } from '@brk/ramp-core';
import { useRampUI } from '../../i18n/provider';
import { Check, ICON_WEIGHT } from '../../internal/icons';

/**
 * Order progress.
 *
 * The step list differs by direction — an on-ramp waits on a PIX payment, an
 * off-ramp waits on a signature — so the stepper is driven by both `direction`
 * and `status` rather than by status alone.
 *
 * Three states, three visual languages, no ambiguity:
 *   done     green disc + tick        the past
 *   current  gold ring + breathing halo, connector sweeping   the present
 *   pending  hollow outline           the future
 *
 * The sweeping connector matters more than it looks. Settlement takes ~25s
 * anchor-side, and a stepper that merely sits there during those seconds is
 * the single most common reason a demo gets read as "stuck".
 */

type StepKey = 'created' | 'action' | 'processing' | 'completed';

const ORDER: StepKey[] = ['created', 'action', 'processing', 'completed'];

const LABELS: Record<RampDirection, Record<StepKey, string>> = {
  onramp: {
    created: 'stepper.onramp.created',
    action: 'stepper.onramp.action',
    processing: 'stepper.onramp.processing',
    completed: 'stepper.onramp.completed',
  },
  offramp: {
    created: 'stepper.offramp.created',
    action: 'stepper.offramp.action',
    processing: 'stepper.offramp.processing',
    completed: 'stepper.offramp.completed',
  },
};

function activeStep(status: OrderStatus): StepKey {
  switch (status) {
    case 'created':
      return 'created';
    case 'awaiting_payment':
    case 'awaiting_signature':
      return 'action';
    case 'processing':
      return 'processing';
    case 'completed':
      return 'completed';
    default:
      return 'action';
  }
}

export function OrderStepper({
  direction,
  status,
}: {
  direction: RampDirection;
  status: OrderStatus;
}) {
  const { t } = useRampUI();
  const failed = status === 'failed' || status === 'expired';
  const currentIndex = ORDER.indexOf(activeStep(status));

  return (
    <ol className="flex items-start gap-1">
      {ORDER.map((step, i) => {
        const done = i < currentIndex || status === 'completed';
        const current = i === currentIndex && status !== 'completed';
        const isLast = i === ORDER.length - 1;

        return (
          <li key={step} className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="flex w-full items-center">
              <span
                aria-hidden="true"
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-bold transition-all duration-300 ${
                  failed && current
                    ? 'border-danger bg-danger/20 text-danger'
                    : done
                      ? 'border-success bg-success text-canvas'
                      : current
                        ? 'animate-halo border-gold bg-gold/12 text-gold'
                        : 'border-line-strong text-fg-subtle'
                }`}
              >
                {done ? <Check size={13} weight={ICON_WEIGHT} className="animate-tick" /> : i + 1}
              </span>

              {!isLast ? (
                <span
                  aria-hidden="true"
                  className={`relative mx-2 h-0.5 flex-1 overflow-hidden rounded-full ${
                    done ? 'bg-success' : 'bg-line-strong'
                  }`}
                >
                  {/* Work in progress, without inventing a percentage. */}
                  {current && !failed ? (
                    <span className="animate-sweep absolute inset-y-0 w-1/3 rounded-full bg-gold" />
                  ) : null}
                </span>
              ) : null}
            </div>

            <span
              className={`text-xs leading-snug transition-colors ${
                current ? 'font-semibold text-fg' : done ? 'text-fg-muted' : 'text-fg-subtle'
              }`}
            >
              {t(LABELS[direction][step])}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
