'use client';

import { useEffect, useState } from 'react';
import type { AdapterCapabilities } from '@brk/ramp-core';
import { ModeBadge } from '@brk/ramp-ui';
import { ErrorAlert } from '@/components/feedback/ErrorAlert';
import { Check, ICON_WEIGHT } from '@/components/icons';
import { attest, type AttestationResult } from '@/client/identity';
import { useI18n } from '@/client/i18n';

/**
 * Get attested for an anchor.
 *
 * **The anchor still performs its own KYC.** What the credential removes is the
 * blind re-discovery: without it the router shows prices from anchors the user
 * cannot execute against, and they find out after choosing one. The disclaimer
 * is on screen and also inside the credential, so it survives being read
 * somewhere else.
 *
 * In a real deployment the button would be a webhook — the anchor tells us
 * onboarding completed, and we attest. Driving it by hand is honest for a demo
 * and labelled as such.
 *
 * Only anchors that can take an order appear: one that merely quotes has
 * nothing to gate on onboarding, and offering to attest for it would imply a
 * check nobody makes.
 */
export function AttestPanel({ did }: { did: string | null }) {
  const { t } = useI18n();

  const [anchors, setAnchors] = useState<AdapterCapabilities[]>([]);
  const [results, setResults] = useState<Record<string, AttestationResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void (async () => {
      try {
        const all = (await (await fetch('/api/anchors')).json()) as AdapterCapabilities[];
        setAnchors(all.filter((a) => a.features.orders));
      } catch {
        // The panel is additive; a failed anchor list leaves it empty rather
        // than breaking the page around it.
      }
    })();
  }, []);

  const run = async (anchorId: string) => {
    if (!did) return;
    setBusy(anchorId);
    setError(null);
    try {
      const result = await attest(did, anchorId);
      setResults((prev) => ({ ...prev, [anchorId]: result }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card p-6">
      <h2 className="section-title">{t('identity.attest.title')}</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-muted">
        {t('identity.attest.body')}
      </p>
      <p className="mt-3 max-w-prose text-xs leading-relaxed text-fg-subtle">
        {t('identity.attest.notKyc')}
      </p>

      {!did ? (
        <p className="well mt-5 p-3 text-sm text-fg-muted">{t('identity.attest.needDid')}</p>
      ) : (
        <div className="mt-5 space-y-3">
          {anchors.map((anchor) => {
            const result = results[anchor.id];
            return (
              <div
                key={anchor.id}
                className="well flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {anchor.name}
                    <ModeBadge mode={anchor.mode} />
                  </span>
                  {result ? (
                    <code className="mt-1 block break-all text-[11px] text-success">
                      {result.vcId}
                    </code>
                  ) : null}
                </div>

                {result ? (
                  <span className="flex items-center gap-1.5 text-xs text-verde">
                    <Check size={13} weight={ICON_WEIGHT} aria-hidden="true" />
                    {t(result.alreadyIssued ? 'identity.attest.already' : 'identity.attest.done')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void run(anchor.id)}
                    disabled={busy !== null}
                    className="btn btn-outline btn-sm"
                  >
                    {busy === anchor.id ? t('common.loading') : t('identity.attest.action')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error ? (
        <div className="mt-4">
          <ErrorAlert error={error} />
        </div>
      ) : null}
    </section>
  );
}
