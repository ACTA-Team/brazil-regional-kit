'use client';

import { useState } from 'react';
import { USD, USDC } from '@brk/ramp-core';
import { useI18n } from '@/lib/i18n';
import { Check, ICON_WEIGHT } from './icons';
import { useWallet } from '@/lib/wallet';
import { Alert } from './Alert';

interface FirmQuote {
  id: string;
  price: string;
  total_price: string;
  sell_amount: string;
  buy_amount: string;
  expires_at: string;
  fee: { total: string; asset: string };
}

/**
 * The full SEP handshake, on screen.
 *
 * Everything the router shows comes from unauthenticated SEP-38 `/price`, which
 * is indicative — good enough to compare anchors, not good enough to execute
 * against. This panel walks the rest of the standard: SEP-10 to get a token,
 * then a firm reserved quote, then a SEP-24 interactive session. It is the
 * difference between "we call one anchor's API" and "we speak the ecosystem's
 * protocol", which is the whole argument for building the kit this way.
 */
export function SepAuthPanel() {
  const { t } = useI18n();
  const { address, sign, status } = useWallet();

  const [token, setToken] = useState<string | null>(null);
  const [claims, setClaims] = useState<Record<string, unknown> | null>(null);
  const [quote, setQuote] = useState<FirmQuote | null>(null);
  const [busy, setBusy] = useState<null | 'auth' | 'quote' | 'interactive'>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = status === 'connected' && Boolean(address);

  const authenticate = async () => {
    setBusy('auth');
    setError(null);
    try {
      // The server fetches AND verifies the challenge before we ever sign it.
      const challengeRes = await fetch(`/api/sep/challenge?account=${encodeURIComponent(address)}`);
      const challenge = (await challengeRes.json()) as {
        transaction?: string;
        networkPassphrase?: string;
        error?: { message: string };
      };
      if (!challenge.transaction) throw new Error(challenge.error?.message ?? 'No challenge.');

      const signed = await sign(challenge.transaction);

      const tokenRes = await fetch('/api/sep/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signed }),
      });
      const payload = (await tokenRes.json()) as {
        token?: string;
        claims?: Record<string, unknown>;
        error?: { message: string };
      };
      if (!payload.token) throw new Error(payload.error?.message ?? 'No token returned.');

      setToken(payload.token);
      setClaims(payload.claims ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const getFirmQuote = async () => {
    if (!token) return;
    setBusy('quote');
    setError(null);
    try {
      const res = await fetch('/api/sep/firm-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jwt: token,
          sellAsset: USDC,
          buyAsset: USD,
          sellAmount: '100',
        }),
      });
      const payload = (await res.json()) as { quote?: FirmQuote; error?: { message: string } };
      if (!payload.quote) throw new Error(payload.error?.message ?? 'No firm quote returned.');
      setQuote(payload.quote);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const openInteractive = async () => {
    if (!token) return;
    setBusy('interactive');
    setError(null);
    try {
      const res = await fetch('/api/sep/interactive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jwt: token,
          asset: USDC,
          account: address,
          direction: 'deposit',
        }),
      });
      const payload = (await res.json()) as { url?: string; error?: { message: string } };
      if (!payload.url) throw new Error(payload.error?.message ?? 'No interactive URL returned.');
      window.open(payload.url, 'sep24', 'width=480,height=760');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold">{t('sep.title')}</h2>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t('sep.subtitle')}</p>
      </div>

      {!connected ? <Alert tone="info">{t('common.connectFirst')}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <ol className="space-y-3">
        <SepStep
          index={1}
          title={t('sep.step1')}
          description={t('sep.step1Hint')}
          done={Boolean(token)}
        >
          <button
            type="button"
            onClick={() => void authenticate()}
            disabled={!connected || busy !== null}
            className="btn btn-primary text-xs"
          >
            {busy === 'auth'
              ? t('common.signing')
              : token
                ? t('sep.reauth')
                : t('sep.authenticate')}
          </button>

          {claims ? (
            <dl className="mt-3 grid gap-1 font-mono text-[11px] text-fg-muted">
              {(['sub', 'iss', 'exp'] as const).map((key) =>
                claims[key] !== undefined ? (
                  <div key={key} className="flex gap-2">
                    <dt className="text-fg-subtle">{key}</dt>
                    <dd className="min-w-0 flex-1 truncate">
                      {key === 'exp'
                        ? new Date(Number(claims[key]) * 1000).toLocaleString()
                        : String(claims[key])}
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
          ) : null}
        </SepStep>

        <SepStep
          index={2}
          title={t('sep.step2')}
          description={t('sep.step2Hint')}
          done={Boolean(quote)}
        >
          <button
            type="button"
            onClick={() => void getFirmQuote()}
            disabled={!token || busy !== null}
            className="btn btn-ghost text-xs"
          >
            {busy === 'quote' ? t('common.loading') : t('sep.firmQuote')}
          </button>

          {quote ? (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Field label={t('common.youSend')} value={`${quote.sell_amount} USDC`} />
              <Field label={t('common.youReceive')} value={`$${quote.buy_amount}`} accent />
              <Field label={t('common.fee')} value={quote.fee.total} />
              <Field
                label={t('sep.expiresAt')}
                value={new Date(quote.expires_at).toLocaleTimeString()}
              />
              <div className="col-span-2 sm:col-span-4">
                <span className="text-xs uppercase tracking-wide text-fg-subtle">
                  {t('sep.quoteId')}
                </span>
                <p className="mt-0.5 break-all font-mono text-[11px] text-fg-muted">{quote.id}</p>
              </div>
            </dl>
          ) : null}
        </SepStep>

        <SepStep index={3} title={t('sep.step3')} description={t('sep.step3Hint')} done={false}>
          <button
            type="button"
            onClick={() => void openInteractive()}
            disabled={!token || busy !== null}
            className="btn btn-ghost text-xs"
          >
            {busy === 'interactive' ? t('common.loading') : t('sep.openInteractive')}
          </button>
        </SepStep>
      </ol>
    </section>
  );
}

function SepStep({
  index,
  title,
  description,
  done,
  children,
}: {
  index: number;
  title: string;
  description: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-lg bg-inset p-4">
      <span
        aria-hidden="true"
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${
          done ? 'border-success bg-success text-white' : 'border-line text-fg-subtle'
        }`}
      >
        {done ? <Check size={12} weight={ICON_WEIGHT} aria-hidden="true" /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>
        <div className="mt-3">{children}</div>
      </div>
    </li>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className={`mt-0.5 font-semibold tabular-nums ${accent ? 'text-gold' : ''}`}>{value}</dd>
    </div>
  );
}
