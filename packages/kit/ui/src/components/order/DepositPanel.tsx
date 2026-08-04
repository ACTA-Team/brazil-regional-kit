'use client';

import type { PaymentInstructions } from '@brk/ramp-core';
import { formatMoney, useRampUI } from '../../i18n/provider';
import { ExpiryPill } from '../quote/Countdown';
import { PixPanel } from './PixPanel';

/**
 * How the customer funds an on-ramp.
 *
 * Two shapes reach this component and both are normal. A PIX payload gets the
 * QR treatment. A bank deposit — which is what the Etherfuse sandbox returns,
 * since it names the rail but issues no payable PIX code — gets the account
 * details instead.
 *
 * The important part is that neither case leaves the user staring at a step
 * with nothing to do: the sandbox settlement button is always here.
 */
export function DepositPanel({
  instructions,
  onSimulate,
  simulating,
}: {
  instructions: PaymentInstructions;
  onSimulate?: () => void;
  simulating?: boolean;
}) {
  const { t, locale } = useRampUI();

  if (instructions.type === 'pix') {
    return <PixPanel instructions={instructions} onSimulate={onSimulate} simulating={simulating} />;
  }

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="section-title">{t('onramp.depositTitle')}</h3>
        <ExpiryPill />
      </div>
      <p className="mt-1 text-sm text-fg-muted">{t('onramp.depositHint')}</p>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <dt className="label">{t('common.amount')}</dt>
          <dd className="figure mt-1.5 text-2xl">
            {formatMoney(instructions.amount, instructions.currency, locale)}
          </dd>
        </div>
        <div>
          <dt className="label">{t('onramp.rail')}</dt>
          <dd className="mt-1 font-semibold">{instructions.rail}</dd>
        </div>
        {instructions.accountLabel ? (
          <div>
            <dt className="label">{t('onramp.beneficiary')}</dt>
            <dd className="mt-1 font-semibold">{instructions.accountLabel}</dd>
          </div>
        ) : null}
        {instructions.reference ? (
          <div className="col-span-2 sm:col-span-3">
            <dt className="label">{t('onramp.reference')}</dt>
            <dd className="mt-1 break-all font-mono text-sm">{instructions.reference}</dd>
          </div>
        ) : null}
      </dl>

      {/*
        The sandbox names the rail but issues no payable reference, so there is
        nothing for the user to copy. Say that plainly rather than showing an
        empty field and letting them wonder what they missed.
      */}
      {!instructions.reference ? (
        <p className="well mt-3 p-3 text-xs text-fg-muted">{t('onramp.sandboxNoReference')}</p>
      ) : null}

      {onSimulate ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSimulate}
            disabled={simulating}
            className="btn btn-primary btn-sm"
          >
            {simulating ? t('common.loading') : t('onramp.simulatePayment')}
          </button>
          <span className="text-xs text-fg-subtle">{t('onramp.simulateHint')}</span>
        </div>
      ) : null}
    </div>
  );
}
