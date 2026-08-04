'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { PixInstructions } from '@brk/ramp-core';
import { formatMoney, useRampUI } from '../../i18n/provider';
import { ExpiryPill } from '../quote/Countdown';

/**
 * The PIX payment panel.
 *
 * The code rendered here is a real EMV BR Code — correct TLV structure, correct
 * CRC16 — so a Brazilian bank app parses it rather than rejecting it outright.
 * In sandbox the PIX key is non-routable, so it parses and then goes nowhere,
 * which is exactly the behaviour a demo wants.
 */
export function PixPanel({
  instructions,
  onSimulate,
  simulating,
}: {
  instructions: PixInstructions;
  onSimulate?: () => void;
  simulating?: boolean;
}) {
  const { t, locale } = useRampUI();
  const [generated, setGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // An anchor-supplied image needs no state at all — it is already a prop.
  // State exists only for the one we have to render ourselves.
  const qr = instructions.qrImage ?? generated;

  useEffect(() => {
    if (instructions.qrImage) return;

    let cancelled = false;
    QRCode.toDataURL(instructions.code, {
      width: 220,
      margin: 1,
      color: { dark: '#05070e', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setGenerated(url);
      })
      .catch(() => {
        if (!cancelled) setGenerated(null);
      });

    return () => {
      cancelled = true;
    };
  }, [instructions.code, instructions.qrImage]);

  const copy = async () => {
    await navigator.clipboard.writeText(instructions.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="section-title">{t('onramp.pixTitle')}</h3>
        <ExpiryPill expiresAt={instructions.expiresAt} />
      </div>
      <p className="mt-1 text-sm text-fg-muted">{t('onramp.pixHint')}</p>

      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
        {qr ? (
          <img
            src={qr}
            alt=""
            width={180}
            height={180}
            className="mx-auto shrink-0 rounded-lg bg-white p-2 sm:mx-0"
          />
        ) : null}

        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <span className="label">{t('common.amount')}</span>
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoney(instructions.amount, instructions.currency, locale)}
            </p>
          </div>

          <div>
            <span className="label">PIX copia e cola</span>
            <p className="well mt-1.5 max-h-24 overflow-y-auto p-2.5 text-[11px] leading-relaxed break-all text-fg-muted">
              {instructions.code}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className="btn btn-ghost btn-sm">
              {copied ? t('common.copied') : t('common.copy')}
            </button>

            {onSimulate ? (
              <button
                type="button"
                onClick={onSimulate}
                disabled={simulating}
                title={t('onramp.simulateHint')}
                className="btn btn-primary btn-sm"
              >
                {simulating ? t('common.loading') : t('onramp.simulatePayment')}
              </button>
            ) : null}
          </div>

          {onSimulate ? <p className="text-xs text-fg-subtle">{t('onramp.simulateHint')}</p> : null}
        </div>
      </div>
    </div>
  );
}
