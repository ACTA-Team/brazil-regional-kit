'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@brk/ramp-ui';
import { USD, USDC } from '@brk/ramp-core';
import { useI18n } from '@/client/i18n';
import { Check, ICON_WEIGHT } from '@/components/icons';
import { useWallet } from '@/client/wallet';

/**
 * What the app can say about a SEP-24 session on its own authority.
 *
 * The interactive window belongs to the anchor, and the SDF reference anchor
 * opens it on a status screen with every field blank. That is accurate — a new
 * transaction really is "incomplete" with no amounts until its form is filled —
 * but it is indistinguishable from a broken integration. Reading the
 * transaction back and showing its id and live status makes the step verifiable
 * here, whatever the anchor's own UI chooses to render.
 */
interface Sep24Session {
  id: string;
  kind?: string;
  status?: string;
  amountIn?: string | null;
  amountOut?: string | null;
  moreInfoUrl?: string | null;
  /** The interactive window, offered rather than forced open. */
  url?: string;
}

/**
 * SEP-24 status codes are protocol identifiers, not sentences.
 *
 * `incomplete` in particular reads as a failure to anyone who has not memorised
 * the spec, when all it means is that the anchor's own interactive flow has not
 * run yet. Showing the raw enum as the headline was making a working handshake
 * look broken, so each state is spelled out and the original value stays in the
 * title attribute for anyone checking against the spec.
 */
const STATUS_KEY: Record<string, string> = {
  incomplete: 'sep.status.incomplete',
  pending_user_transfer_start: 'sep.status.pendingUserTransfer',
  pending_user_transfer_complete: 'sep.status.pendingAnchor',
  pending_anchor: 'sep.status.pendingAnchor',
  pending_stellar: 'sep.status.pendingStellar',
  pending_external: 'sep.status.pendingExternal',
  pending_trust: 'sep.status.pendingTrust',
  pending_user: 'sep.status.pendingUser',
  completed: 'sep.status.completed',
  refunded: 'sep.status.refunded',
  expired: 'sep.status.expired',
  error: 'sep.status.error',
};

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
  const [session, setSession] = useState<Sep24Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = status === 'connected' && Boolean(address);

  /**
   * Follow the anchor's own record of the session while the popup is open.
   *
   * The transaction starts `incomplete` and only gains amounts once the user
   * finishes the anchor's form, which happens in a window this app cannot see
   * into. Polling is the only way to notice, and it stops on its own once the
   * anchor reaches a state it will not move out of.
   */
  const sessionId = session?.id ?? null;
  const sessionStatus = session?.status;
  const settled = sessionStatus === 'completed' || sessionStatus === 'error';

  const refreshSession = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        const res = await fetch('/api/sep/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jwt: token, id }),
        });
        const payload = (await res.json()) as Sep24Session & { error?: unknown };
        if (payload.id) setSession((prev) => ({ ...payload, url: prev?.url ?? payload.url }));
      } catch {
        // A failed poll is not news worth interrupting the user with; the next
        // tick tries again and the last known status stays on screen.
      }
    },
    [token],
  );

  useEffect(() => {
    if (!sessionId || settled) return;
    // Deferred a tick so the first poll's setState never lands synchronously
    // inside the effect body.
    const first = setTimeout(() => void refreshSession(sessionId), 0);
    const timer = setInterval(() => void refreshSession(sessionId), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [sessionId, settled, refreshSession]);

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
      const payload = (await res.json()) as {
        url?: string;
        id?: string;
        error?: { message: string };
      };
      if (!payload.url) throw new Error(payload.error?.message ?? 'No interactive URL returned.');

      if (payload.id) setSession({ id: payload.id, url: payload.url });
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

        <SepStep
          index={3}
          title={t('sep.step3')}
          description={t('sep.step3Hint')}
          done={Boolean(session)}
        >
          <button
            type="button"
            onClick={() => void openInteractive()}
            disabled={!token || busy !== null}
            className="btn btn-outline btn-sm"
          >
            {busy === 'interactive' ? t('common.loading') : t('sep.openInteractive')}
          </button>

          {/*
            The anchor owns the popup and the SDF reference anchor opens it on a
            blank status screen. Rather than leave that looking like a failure,
            the app states what it knows for itself: the transaction exists, the
            anchor answers for it, and this is its status right now.
          */}
          {session ? (
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-success">
                <Check size={13} weight={ICON_WEIGHT} aria-hidden="true" />
                {t('sep.sessionOpen')}
              </p>

              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <Field label={t('sep.kind')} value={session.kind ?? '…'} />
                <div title={session.status}>
                  <span className="text-xs uppercase tracking-wide text-fg-subtle">
                    {t('common.status')}
                  </span>
                  <p className="mt-0.5 font-medium">
                    {session.status
                      ? (STATUS_KEY[session.status] ?? '') !== ''
                        ? t(STATUS_KEY[session.status]!)
                        : session.status
                      : '…'}
                  </p>
                </div>
                <Field label={t('sep.anchorLabel')} value="testanchor.stellar.org" />
                <div className="col-span-2 sm:col-span-3">
                  <span className="text-xs uppercase tracking-wide text-fg-subtle">
                    {t('sep.transactionId')}
                  </span>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-fg-muted">
                    {session.id}
                  </p>
                </div>
              </dl>

              <p className="text-xs leading-relaxed text-fg-muted">{t('sep.sessionHint')}</p>

              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {session.url ? (
                  <a
                    href={session.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-link text-xs"
                  >
                    {t('sep.openWindow')}
                  </a>
                ) : null}
                {session.moreInfoUrl ? (
                  <a
                    href={session.moreInfoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-link text-xs"
                  >
                    {t('sep.viewOnAnchor')}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
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
