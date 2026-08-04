'use client';

import { useEffect, useState } from 'react';
import { Alert } from '@brk/ramp-ui';
import { PageIntro } from '@/components/layout/PageIntro';
import { PageShell } from '@/components/layout/PageShell';
import { NetworkBanner } from '@/components/wallet/WalletButton';
import {
  claimDid,
  forgetDid,
  getIdentityStatus,
  recallDid,
  type DidResolution,
  type IdentityStatus,
} from '@/client/identity';
import { useI18n } from '@/client/i18n';
import { useWallet } from '@/client/wallet';
import { AttestPanel } from '@/features/identity/AttestPanel';
import { DidPanel } from '@/features/identity/DidPanel';
import { PocPanel } from '@/features/identity/PocPanel';

/**
 * Step 6: the identity the other five steps quietly assume.
 *
 * The router page answers "who is cheapest". It could not answer "and can I
 * take it" — onboarding is per anchor, so a user learns an anchor is closed to
 * them after choosing it, when the payment comes back KYC_REQUIRED. A DID plus
 * an attestation per anchor is what lets the price table say which rows are
 * actually executable.
 *
 * The honest limit is stated on the page, not buried in our docs: no anchor
 * accepts another anchor's KYC, because the obligation is per institution. This
 * is a reusable attestation layer, not portable KYC.
 */
export function IdentityPage() {
  const { t } = useI18n();
  const { address, status } = useWallet();

  const [identityStatus, setIdentityStatus] = useState<IdentityStatus | null>(null);
  const [resolution, setResolution] = useState<DidResolution | null>(null);

  useEffect(() => {
    void getIdentityStatus()
      .then(setIdentityStatus)
      // A status we cannot read is not worth an error banner over: every panel
      // below already handles its own failures.
      .catch(() => setIdentityStatus(null));
  }, []);

  /*
   * Re-validate whatever the browser remembered, every time the wallet changes.
   *
   * localStorage is a cache, not a claim. Without the controller check the
   * router would annotate quotes against whoever last used this browser —
   * showing one person's onboarding to another, which is worse than showing
   * nothing at all.
   */
  useEffect(() => {
    let cancelled = false;

    // Deferred a tick so no branch of this lands a setState synchronously
    // inside the effect body — the convention the wallet provider uses.
    const id = setTimeout(() => {
      const remembered = recallDid();

      if (status !== 'connected' || !address || !remembered) {
        setResolution(null);
        return;
      }

      void claimDid(remembered, address)
        .then((claimed) => {
          if (cancelled) return;
          // Resolved, but this wallet does not control it. Dropping it is the
          // point: otherwise the router would annotate quotes with somebody
          // else's onboarding.
          if (!claimed) forgetDid();
          setResolution(claimed);
        })
        .catch(() => {
          if (!cancelled) setResolution(null);
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [address, status]);

  const mode = identityStatus?.mode ?? 'mock';

  return (
    <PageShell
      className="space-y-6"
      intro={
        <PageIntro
          title={t('identity.title')}
          subtitle={t('identity.subtitle')}
          plate="cristo-light"
        />
      }
    >
      <NetworkBanner />

      {/*
        The credibility line, first thing on the page.

        Same rule as the anchor status table: what is real and what is simulated
        is stated where the claim is made, and it is served from the code that
        does the work rather than typed in by hand.
      */}
      <Alert
        tone={mode === 'live' ? 'success' : 'info'}
        title={t(mode === 'live' ? 'identity.mode.liveTitle' : 'identity.mode.mockTitle')}
      >
        <p className="leading-relaxed">
          {t(mode === 'live' ? 'identity.mode.liveBody' : 'identity.mode.mockBody')}
        </p>
        {identityStatus?.issuerDid ? (
          <p className="mt-2 text-xs">
            {t('identity.mode.issuer')}{' '}
            <code className="break-all text-success">{identityStatus.issuerDid}</code>
          </p>
        ) : null}
      </Alert>

      <DidPanel mode={mode} resolution={resolution} onChange={setResolution} />
      <AttestPanel did={resolution?.did ?? null} />
      <PocPanel did={resolution?.did ?? null} mode={mode} />

      <section className="card p-6">
        <h2 className="section-title">{t('identity.next.title')}</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-muted">
          {t('identity.next.body')}
        </p>
        <a href="/router" className="btn btn-outline btn-sm mt-4">
          {t('identity.next.action')}
        </a>
      </section>
    </PageShell>
  );
}
