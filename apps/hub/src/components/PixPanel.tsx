'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { PixInstructions } from '@brk/ramp-core';
import { formatMoney, useI18n } from '@/lib/i18n';
import { ExpiryPill } from './Countdown';

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
  const { t, tag } = useI18n();
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
      color: { dark: '#0b1220', light: '#ffffff' },
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
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{t('onramp.pixTitle')}</h3>
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
            <span className="text-xs uppercase tracking-wide text-fg-subtle">
              {t('common.amount')}
            </span>
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoney(instructions.amount, instructions.currency, tag)}
            </p>
          </div>

          <div>
            <span className="text-xs uppercase tracking-wide text-fg-subtle">PIX copia e cola</span>
            <p className="mt-1 max-h-24 overflow-y-auto break-all rounded-lg bg-inset p-2.5 font-mono text-[11px] leading-relaxed text-fg-muted">
              {instructions.code}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className="btn btn-ghost text-xs">
              {copied ? t('common.copied') : t('common.copy')}
            </button>

            {onSimulate ? (
              <button
                type="button"
                onClick={onSimulate}
                disabled={simulating}
                title={t('onramp.simulateHint')}
                className="btn btn-primary text-xs"
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
