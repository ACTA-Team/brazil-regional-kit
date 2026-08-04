'use client';

import { useState } from 'react';
import { Alert } from '@brk/ramp-ui';
import { PAYMENT_HEADER, buildPaymentTx, explorerTxUrl } from '@brk/stablecoin-kit';
import { PageIntro } from '@/components/PageIntro';
import { Check, ICON_WEIGHT } from '@/components/icons';
import { NetworkBanner } from '@/components/WalletButton';
import { submitSignedTx } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useWallet } from '@/lib/wallet';

const RESOURCE = '/api/premium-fx';

interface Requirement {
  scheme: string;
  network: string;
  asset: string;
  assetCode: string;
  amount: string;
  payTo: string;
  memo: string;
  resource: string;
  description?: string;
  maxTimeoutSeconds: number;
}

interface Challenge {
  x402Version: number;
  error: string;
  accepts: Requirement[];
}

interface Resource {
  paidWith: { txHash: string; amount: string; from: string; settledAt: string };
  rates: Array<{
    pair: string;
    rate: string;
    anchor: string;
    mode: string;
    buyAmountPer100: string;
  }>;
  generatedAt: string;
}

/**
 * The x402 round trip, made visible.
 *
 * Each step shows the actual HTTP status, so the protocol is legible rather
 * than hidden behind a spinner: 402 with terms, a real on-chain payment, then
 * 200 with the resource.
 */
export default function X402Page() {
  const { t } = useI18n();
  const { address, sign, status, onTestnet, refreshBalances } = useWallet();

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [resource, setResource] = useState<Resource | null>(null);
  const [busy, setBusy] = useState<null | 'requesting' | 'paying' | 'retrying'>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<number | null>(null);

  const connected = status === 'connected' && Boolean(address);
  const requirement = challenge?.accepts[0];

  const requestUnpaid = async () => {
    setBusy('requesting');
    setError(null);
    setResource(null);
    setTxHash(null);
    try {
      const res = await fetch(RESOURCE);
      setLastStatus(res.status);
      setChallenge((await res.json()) as Challenge);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pay = async () => {
    if (!requirement) return;
    setBusy('paying');
    setError(null);
    try {
      const xdr = await buildPaymentTx({
        from: address,
        to: requirement.payTo,
        asset: requirement.asset,
        amount: requirement.amount,
        memo: requirement.memo,
      });
      const signed = await sign(xdr);
      const result = await submitSignedTx(signed);
      setTxHash(result.hash);
      await refreshBalances();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const retryWithProof = async () => {
    if (!txHash) return;
    setBusy('retrying');
    setError(null);
    try {
      const res = await fetch(RESOURCE, { headers: { [PAYMENT_HEADER]: txHash } });
      setLastStatus(res.status);
      const payload = (await res.json()) as Resource | Challenge;
      if ('rates' in payload) {
        setResource(payload);
      } else {
        setChallenge(payload);
        setError(payload.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <PageIntro step={5} title={t('x402.title')} subtitle={t('x402.subtitle')} />

      <NetworkBanner />
      {!connected ? <Alert tone="info">{t('common.connectFirst')}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <ol className="space-y-4">
        {/* ── 1 ─────────────────────────────────────────────────────────── */}
        <Step
          index={1}
          title={t('x402.step1')}
          hint={t('x402.step1Hint')}
          done={Boolean(challenge)}
        >
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void requestUnpaid()}
              disabled={busy !== null}
              className={`btn btn-sm ${challenge ? 'btn-outline' : 'btn-primary'}`}
            >
              {busy === 'requesting' ? t('common.loading') : t('x402.request')}
            </button>
            <code className="font-mono text-xs text-fg-subtle">GET {RESOURCE}</code>
            {challenge && lastStatus ? <StatusPill status={lastStatus} /> : null}
          </div>

          {requirement ? (
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Field
                label={t('x402.price')}
                value={`${requirement.amount} ${requirement.assetCode}`}
                accent
              />
              <Field label={t('x402.memo')} value={requirement.memo} mono />
              <Field label="Network" value={requirement.network} mono />
              <Field label={t('x402.window')} value={`${requirement.maxTimeoutSeconds}s`} mono />
              <div className="col-span-2 sm:col-span-4">
                <span className="text-xs uppercase tracking-wide text-fg-subtle">
                  {t('x402.payTo')}
                </span>
                <p className="mt-0.5 break-all font-mono text-[11px] text-fg-muted">
                  {requirement.payTo}
                </p>
              </div>
            </dl>
          ) : null}
        </Step>

        {/* ── 2 ─────────────────────────────────────────────────────────── */}
        <Step index={2} title={t('x402.step2')} hint={t('x402.step2Hint')} done={Boolean(txHash)}>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void pay()}
              disabled={!requirement || !connected || !onTestnet || busy !== null}
              className={`btn btn-sm ${requirement && !txHash ? 'btn-primary' : 'btn-outline'}`}
            >
              {busy === 'paying'
                ? t('common.signing')
                : requirement
                  ? `${t('x402.pay')} · ${requirement.amount} ${requirement.assetCode}`
                  : t('x402.pay')}
            </button>
            {txHash ? (
              <a
                href={explorerTxUrl(txHash)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-gold underline-offset-2 hover:underline"
              >
                {txHash.slice(0, 16)}…
              </a>
            ) : null}
          </div>
        </Step>

        {/* ── 3 ─────────────────────────────────────────────────────────── */}
        <Step index={3} title={t('x402.step3')} hint={t('x402.step3Hint')} done={Boolean(resource)}>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void retryWithProof()}
              disabled={!txHash || busy !== null}
              className={`btn btn-sm ${txHash && !resource ? 'btn-primary' : 'btn-outline'}`}
            >
              {busy === 'retrying' ? t('common.loading') : t('x402.request')}
            </button>
            <code className="font-mono text-xs text-fg-subtle">
              GET {RESOURCE} · {PAYMENT_HEADER}: {txHash ? `${txHash.slice(0, 10)}…` : '…'}
            </code>
            {resource && lastStatus ? <StatusPill status={lastStatus} /> : null}
          </div>

          {resource ? (
            <div className="mt-4 space-y-3">
              <div className="overflow-x-auto rounded-lg bg-inset">
                <table className="w-full min-w-[24rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-fg-subtle">
                      <th className="px-3 py-2 font-medium">Pair</th>
                      <th className="px-3 py-2 text-right font-medium">Rate</th>
                      <th className="px-3 py-2 font-medium">{t('common.anchor')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resource.rates.map((r) => (
                      <tr key={r.pair} className="border-t border-line/60">
                        <td className="px-3 py-2 font-mono text-xs">{r.pair}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-gold">
                          {Number(r.rate).toFixed(4)}
                        </td>
                        <td className="px-3 py-2 text-xs text-fg-muted">{r.anchor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-fg-subtle">{t('x402.replayNote')}</p>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void retryWithProof()}
                  className="btn btn-ghost text-xs"
                >
                  {t('common.retry')}
                </button>
                <button
                  type="button"
                  onClick={() => void requestUnpaid()}
                  className="btn btn-ghost text-xs"
                >
                  {t('x402.reset')}
                </button>
              </div>
            </div>
          ) : null}
        </Step>
      </ol>

      <section className="card p-5">
        <h2 className="text-sm font-semibold">{t('x402.whyTitle')}</h2>
        <p className="mt-1.5 text-sm text-fg-muted">{t('x402.why')}</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-inset p-3 font-mono text-[11px] leading-relaxed text-fg-muted">
          {`import { createX402Guard } from '@brk/stablecoin-kit/x402';

const guard = createX402Guard({
  payTo: MERCHANT_ACCOUNT,
  asset: TESOURO,     // or USDC, or your own regional stablecoin
  price: '0.10',
});`}
        </pre>
      </section>
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function Step({
  index,
  title,
  hint,
  done,
  children,
}: {
  index: number;
  title: string;
  hint: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="card p-5">
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${
            done ? 'border-success bg-success text-white' : 'border-line text-fg-subtle'
          }`}
        >
          {done ? <Check size={12} weight={ICON_WEIGHT} aria-hidden="true" /> : index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: number }) {
  const ok = status >= 200 && status < 300;
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${
        ok ? 'bg-success/15 text-success' : 'bg-gold/12 text-gold'
      }`}
    >
      {status} {ok ? 'OK' : 'Payment Required'}
    </span>
  );
}

function Field({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd
        className={`mt-0.5 ${mono ? 'font-mono text-xs' : 'font-semibold'} tabular-nums ${
          accent ? 'text-gold' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
