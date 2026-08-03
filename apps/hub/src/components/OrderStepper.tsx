'use client';

import type { OrderStatus, RampDirection } from '@brk/ramp-core';
import { useI18n } from '@/lib/i18n';

/**
 * Order progress.
 *
 * The step list differs by direction — an on-ramp waits on a PIX payment, an
 * off-ramp waits on a signature — so the stepper is driven by both `direction`
 * and `status` rather than by status alone.
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
  const { t } = useI18n();
  const failed = status === 'failed' || status === 'expired';
  const currentIndex = ORDER.indexOf(activeStep(status));

  return (
    <ol className="flex flex-col gap-0 sm:flex-row sm:items-start sm:gap-0">
      {ORDER.map((step, i) => {
        const done = i < currentIndex || status === 'completed';
        const current = i === currentIndex && status !== 'completed';
        const isLast = i === ORDER.length - 1;

        return (
          <li key={step} className="flex flex-1 gap-3 sm:flex-col sm:gap-2">
            <div className="flex flex-col items-center sm:w-full sm:flex-row">
              <span
                aria-hidden="true"
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-colors ${
                  failed && current
                    ? 'border-red-500 bg-red-500/20 text-red-300'
                    : done
                      ? 'border-brand-500 bg-brand-600 text-white'
                      : current
                        ? 'border-brand-500 text-brand-300'
                        : 'border-border-subtle text-ink-500'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>

              {!isLast ? (
                <span
                  aria-hidden="true"
                  className={`my-1 w-px flex-1 sm:my-0 sm:mx-2 sm:h-px sm:w-auto sm:flex-1 ${
                    done ? 'bg-brand-600' : 'bg-border-subtle'
                  }`}
                  style={{ minHeight: '1.25rem' }}
                />
              ) : null}
            </div>

            <span
              className={`pb-4 text-xs sm:pb-0 ${
                current || done ? 'text-ink-200' : 'text-ink-500'
              }`}
            >
              {t(LABELS[direction][step])}
              {current && !failed ? (
                <span className="ml-1 inline-block animate-pulse" aria-hidden="true">
                  …
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
