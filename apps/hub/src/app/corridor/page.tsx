'use client';

import { useCallback, useState } from 'react';
import { MXN, TESOURO, USDC, assetCode, checkMemo, compare, isPositive } from '@brk/ramp-core';
import type { AnchorResult } from '@brk/ramp-router';
import { buildPaymentTx, buildSwapTx, explorerTxUrl, type SwapQuote } from '@brk/stablecoin-kit';
import { Alert } from '@/components/Alert';
import { PageIntro } from '@/components/PageIntro';
import {
  ArrowRight,
  ArrowsLeftRight,
  Bank,
  ICON_WEIGHT,
  PaperPlaneTilt,
  type Icon,
} from '@/components/icons';
import { AmountField } from '@/components/AmountField';
import { MemoField } from '@/components/MemoField';
import { ModeBadge } from '@/components/ModeBadge';
import { QuoteTable, type PublicRankedQuote } from '@/components/QuoteTable';
import { TrustlineGate } from '@/components/TrustlineGate';
import { NetworkBanner } from '@/components/WalletButton';
import { submitSignedTx } from '@/lib/api';
import { formatToken, useI18n } from '@/lib/i18n';
import { useWallet } from '@/lib/wallet';

type Step = 'swap' | 'send' | 'payout';

/**
 * São Paulo → Mexico, end to end.
 *
 * Three legs, and only the last one is simulated: the swap fills against the
 * live testnet order books, the transfer is a real Stellar payment, and the
 * payout is quoted by the router but settled by an anchor we have no
 * credentials for. Each leg says which it is.
 */
export default function CorridorPage() {
  const { t, tag } = useI18n();
  const { address, status, balanceOf, sign, refreshBalances, onTestnet } = useWallet();

  const [step, setStep] = useState<Step>('swap');
  const [amount, setAmount] = useState('50');
  const [memo, setMemo] = useState('Para a família');
  /**
   * `null` means "the user has not chosen one", which is different from an
   * empty string. That distinction is what lets the field default to the
   * connected wallet without an effect writing state back on every render —
   * and still lets the user clear it.
   */
  const [recipientOverride, setRecipientOverride] = useState<string | null>(null);
  const recipient = recipientOverride ?? address;
  const setRecipient = setRecipientOverride;

  const [swap, setSwap] = useState<SwapQuote | null>(null);
  const [swapHash, setSwapHash] = useState<string | null>(null);
  const [sendHash, setSendHash] = useState<string | null>(null);
  const [sentAmount, setSentAmount] = useState<string | null>(null);

  const [payout, setPayout] = useState<{
    quotes: PublicRankedQuote[];
    anchors: AnchorResult[];
    elapsedMs: number;
  } | null>(null);
  const [paidOut, setPaidOut] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = status === 'connected' && Boolean(address);
  const tesouroHeld = balanceOf(TESOURO);
  const usdcHeld = balanceOf(USDC);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  // ── Leg 1: swap ────────────────────────────────────────────────────────────

  const quoteTheSwap = () =>
    run('quoting', async () => {
      const params = new URLSearchParams({ sell: TESOURO, buy: USDC, amount });
      const res = await fetch(`/api/swap/quote?${params}`);
      const payload = (await res.json()) as { quote?: SwapQuote; error?: { message: string } };
      if (!payload.quote) throw new Error(payload.error?.message ?? 'No swap quote.');
      setSwap(payload.quote);
    });

  const executeSwap = () =>
    run('swapping', async () => {
      if (!swap) return;
      if (swap.mode === 'simulated') {
        // Nothing to submit — the pair has no path. Carry the quoted amount
        // forward and keep the label on it.
        setSentAmount(swap.buyAmount);
        setStep('send');
        return;
      }
      const xdr = await buildSwapTx(swap, address);
      const signed = await sign(xdr);
      const result = await submitSignedTx(signed);
      setSwapHash(result.hash);
      await refreshBalances();
      setStep('send');
    });

  // ── Leg 2: send ────────────────────────────────────────────────────────────

  /**
   * What this leg actually sends — the balance, never the quote.
   *
   * Two ways the quoted figure is a lie by the time we reach here. A *simulated*
   * swap moved nothing at all, so the USDC it promises was never delivered. And
   * a real path payment fills at whatever the order books give, which is the
   * entire reason `destMin` exists — the fill can legitimately land under the
   * quote. Building a payment for the quoted amount in either case hands the
   * user a transaction that dies on-chain with `op_underfunded`, which reads as
   * a broken app rather than as arithmetic.
   */
  const quotedOut = swap?.buyAmount ?? sentAmount ?? '0';
  const sendable = compare(usdcHeld, quotedOut) < 0 ? usdcHeld : quotedOut;
  const shortOfQuote = compare(sendable, quotedOut) < 0;

  const sendRemittance = () =>
    run('sending', async () => {
      if (!recipient.startsWith('G')) throw new Error(t('corridor.badRecipient'));
      const value = sendable;

      const xdr = await buildPaymentTx({
        from: address,
        to: recipient,
        asset: USDC,
        amount: value,
        memo, // validated against the 28-byte limit inside buildPaymentTx
      });
      const signed = await sign(xdr);
      const result = await submitSignedTx(signed);

      setSendHash(result.hash);
      setSentAmount(value);
      await refreshBalances();
      setStep('payout');
      void quotePayout(value);
    });

  // ── Leg 3: payout ──────────────────────────────────────────────────────────

  /**
   * Called when the remittance lands, not from an effect watching `step`.
   * Fetching because the user did something is clearer than fetching because a
   * render happened, and it keeps the request out of the render cycle entirely.
   */
  const quotePayout = useCallback(
    (forAmount: string) =>
      run('payout', async () => {
        const params = new URLSearchParams({
          sell: USDC,
          buy: MXN,
          amount: forAmount,
          country: 'MX',
        });
        const res = await fetch(`/api/quotes?${params}`);
        const payload = (await res.json()) as typeof payout & { error?: { message: string } };
        if (!payload || 'error' in payload) throw new Error('Could not price the payout.');
        setPayout(payload);
      }),
    [run],
  );

  const memoOk = checkMemo(memo).valid;
  const enoughTesouro = compare(tesouroHeld, amount) >= 0;

  return (
    <div className="space-y-7">
      <PageIntro step={3} title={t('corridor.title')} subtitle={t('corridor.subtitle')} />

      <NetworkBanner />
      {!connected ? <Alert tone="info">{t('common.connectFirst')}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <CorridorSteps step={step} />

      {/* ── Leg 1 ─────────────────────────────────────────────────────────── */}
      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            1 · {t('corridor.step.swap')}: {assetCode(TESOURO)} to {assetCode(USDC)}
          </h2>
          {swap ? <ModeBadge mode={swap.mode === 'dex' ? 'live' : 'mock'} /> : null}
        </div>

        {step === 'swap' ? (
          <>
            <AmountField
              label={t('corridor.amountLabel')}
              value={amount}
              onChange={(v) => {
                setAmount(v);
                setSwap(null);
              }}
              presets={['10', '25', '50', '100']}
            />
            <p className="text-xs text-fg-subtle">
              {t('offramp.youHold')}:{' '}
              <span className="font-mono">{formatToken(tesouroHeld, 'TESOURO', tag)}</span>
            </p>

            <TrustlineGate asset={USDC} />

            {swap ? <SwapSummary quote={swap} /> : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void quoteTheSwap()}
                disabled={!connected || busy !== null || !amount}
                className={`btn ${swap ? 'btn-outline' : 'btn-primary'}`}
              >
                {busy === 'quoting' ? t('common.loading') : t('router.compare')}
              </button>
              <button
                type="button"
                onClick={() => void executeSwap()}
                disabled={
                  !swap || busy !== null || !onTestnet || (swap.mode === 'dex' && !enoughTesouro)
                }
                className={`btn ${swap ? 'btn-primary' : 'btn-outline'}`}
              >
                {busy === 'swapping' ? t('common.signing') : t('corridor.executeSwap')}
              </button>
            </div>

            {swap?.mode === 'dex' && !enoughTesouro ? (
              <Alert tone="warning">{t('offramp.insufficient', { code: 'TESOURO' })}</Alert>
            ) : null}
          </>
        ) : (
          <Alert
            tone="success"
            action={
              swapHash ? (
                <a
                  href={explorerTxUrl(swapHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost text-xs"
                >
                  {t('common.viewOnExplorer')}
                </a>
              ) : undefined
            }
          >
            {t('corridor.swapDone')}.{' '}
            <strong>{formatToken(swap?.buyAmount ?? '0', 'USDC', tag)}</strong>
          </Alert>
        )}
      </section>

      {/* ── Leg 2 ─────────────────────────────────────────────────────────── */}
      {step !== 'swap' ? (
        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">2 · {t('corridor.sendTitle')}</h2>
          <p className="text-sm text-fg-muted">{t('corridor.sendHint')}</p>

          {step === 'send' ? (
            <>
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="recipient" className="text-sm text-fg-muted">
                    {t('corridor.recipientLabel')}
                  </label>
                  <button
                    type="button"
                    onClick={() => setRecipient(address)}
                    className="text-xs text-gold underline-offset-2 hover:underline"
                  >
                    {t('corridor.useMyAddress')}
                  </button>
                </div>
                <input
                  id="recipient"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim())}
                  placeholder="G…"
                  className="field mt-2 font-mono text-xs"
                />
              </div>

              <MemoField value={memo} onChange={setMemo} />

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void sendRemittance()}
                  disabled={
                    busy !== null || !memoOk || !recipient || !onTestnet || !isPositive(sendable)
                  }
                  className="btn btn-primary"
                >
                  {busy === 'sending' ? t('common.signing') : t('corridor.send')}
                </button>
                <span className="font-mono text-xs text-fg-subtle">
                  {formatToken(sendable, 'USDC', tag)}
                </span>
              </div>

              {/*
                Say it rather than quietly sending a different number. After a
                simulated swap this is the honest explanation for why the amount
                dropped; after a real one it is the order book, not a bug.
              */}
              {shortOfQuote ? (
                <Alert tone="warning">
                  {isPositive(sendable)
                    ? t('corridor.sendingBalance', {
                        held: formatToken(sendable, 'USDC', tag),
                        quoted: formatToken(quotedOut, 'USDC', tag),
                      })
                    : t('corridor.noUsdc')}
                </Alert>
              ) : null}
            </>
          ) : (
            <Alert
              tone="success"
              action={
                sendHash ? (
                  <a
                    href={explorerTxUrl(sendHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost text-xs"
                  >
                    {t('common.viewOnExplorer')}
                  </a>
                ) : undefined
              }
            >
              {t('corridor.sent')}. <strong>{formatToken(sentAmount ?? '0', 'USDC', tag)}</strong>{' '}
              <span className="font-mono text-xs">“{memo}”</span>
            </Alert>
          )}
        </section>
      ) : null}

      {/* ── Leg 3 ─────────────────────────────────────────────────────────── */}
      {step === 'payout' ? (
        <section className="space-y-4">
          <div className="card space-y-2 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">3 · {t('corridor.recipientTitle')}</h2>
              <span className="rounded-full bg-inset px-2 py-0.5 text-xs text-fg-muted">
                <Bank size={16} weight={ICON_WEIGHT} aria-hidden="true" />
                {t('corridor.recipientView')}
              </span>
            </div>
            <p className="text-sm text-fg-muted">{t('corridor.recipientHint')}</p>
            <p className="font-mono text-xs text-fg-subtle">
              {formatToken(usdcHeld, 'USDC', tag)} · {recipient.slice(0, 8)}…
            </p>
          </div>

          {payout ? (
            <QuoteTable
              quotes={payout.quotes}
              anchors={payout.anchors}
              elapsedMs={payout.elapsedMs}
            />
          ) : (
            <div className="card p-6 text-center text-sm text-fg-muted">{t('common.loading')}</div>
          )}

          {paidOut ? (
            <Alert tone="success">{t('corridor.payoutDone')}</Alert>
          ) : (
            <Alert
              tone="warning"
              action={
                <button
                  type="button"
                  onClick={() => setPaidOut(true)}
                  disabled={!payout?.quotes.length}
                  className="btn btn-primary"
                >
                  {t('corridor.payout')}
                </button>
              }
            >
              {t('corridor.payoutSimulated')}
            </Alert>
          )}
        </section>
      ) : null}
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function CorridorSteps({ step }: { step: Step }) {
  const { t } = useI18n();
  const steps: Array<{ key: Step; label: string; Glyph: Icon }> = [
    { key: 'swap', label: t('corridor.step.swap'), Glyph: ArrowsLeftRight },
    { key: 'send', label: t('corridor.step.send'), Glyph: PaperPlaneTilt },
    { key: 'payout', label: t('corridor.step.payout'), Glyph: Bank },
  ];
  const currentIndex = steps.findIndex((s) => s.key === step);

  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${
              i <= currentIndex ? 'bg-success/15 text-success' : 'bg-inset text-fg-subtle'
            }`}
          >
            <s.Glyph size={14} weight={ICON_WEIGHT} aria-hidden="true" />
            {s.label}
          </span>
          {i < steps.length - 1 ? (
            <ArrowRight
              size={12}
              weight={ICON_WEIGHT}
              aria-hidden="true"
              className="text-fg-subtle"
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function SwapSummary({ quote }: { quote: SwapQuote }) {
  const { t, tag } = useI18n();
  const dex = quote.mode === 'dex';

  return (
    <div className="rounded-lg bg-inset p-4">
      <p className={`text-sm ${dex ? 'text-success' : 'text-gold'}`}>
        {dex ? t('corridor.swapDex') : t('corridor.swapSimulated')}
      </p>
      {quote.reason ? <p className="mt-1 text-xs text-fg-subtle">{quote.reason}</p> : null}

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">
            {t('common.youReceive')}
          </dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-gold">
            {formatToken(quote.buyAmount, 'USDC', tag)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">{t('common.rate')}</dt>
          <dd className="mt-0.5 font-mono text-sm tabular-nums">
            {Number(quote.price).toFixed(6)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">
            {t('corridor.slippage')}
          </dt>
          <dd className="mt-0.5 font-mono text-sm tabular-nums text-fg-muted">{quote.destMin}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">Path</dt>
          <dd className="mt-0.5 text-sm text-fg-muted">
            {quote.path.length === 0
              ? t('corridor.swapDirect')
              : t('corridor.swapHops', { count: quote.path.length })}
          </dd>
        </div>
      </dl>
    </div>
  );
}
