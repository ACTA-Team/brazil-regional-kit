'use client';

import { useState } from 'react';
import { jcsCanonicalize, MOCK_SIGNATURE_PREFIX, type PocChallenge } from '@brk/identity-kit';
import { signMessageWithWallet } from '@brk/stablecoin-kit';
import { ErrorAlert } from '@/components/feedback/ErrorAlert';
import { Check, ICON_WEIGHT, X } from '@/components/icons';
import { getChallenge, verifyPoc, type PocVerification } from '@/client/identity';
import { useI18n } from '@/client/i18n';
import { useWallet } from '@/client/wallet';

/**
 * Proof of control — logging in as a DID, with no password and no transaction.
 *
 * The server issues a challenge naming this site, the wallet signs it, the
 * server checks the signature against the keys in the DID document it resolves
 * for itself. Nothing is spent and no key leaves the wallet.
 *
 * **Not every wallet can sign a message**, and the ones that can disagree about
 * what exactly they sign — some hash first, some prepend a prefix. So this
 * degrades out loud: an unsupported wallet gets a sentence saying so rather
 * than a wallet-internal error string, and a signature that comes back but does
 * not verify is reported as what it is.
 *
 * In mock mode the browser computes the documented stand-in itself, which is
 * what lets the whole page work with no wallet at all — including in CI.
 */
export function PocPanel({ did, mode }: { did: string | null; mode: 'live' | 'mock' }) {
  const { t } = useI18n();
  const { address, status } = useWallet();

  const [challenge, setChallenge] = useState<PocChallenge | null>(null);
  const [result, setResult] = useState<PocVerification | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState<null | 'challenge' | 'signing'>(null);
  const [error, setError] = useState<unknown>(null);

  const request = async () => {
    if (!did) return;
    setBusy('challenge');
    setError(null);
    setResult(null);
    setUnsupported(false);
    try {
      setChallenge((await getChallenge(did)).challenge);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const proveIt = async () => {
    if (!challenge) return;
    setBusy('signing');
    setError(null);
    try {
      // The signed bytes are the canonical JSON of the challenge — same
      // canonicalization on both sides, or two parties who agree on every value
      // still fail to verify.
      const message = jcsCanonicalize({ ...challenge });

      const signature =
        mode === 'mock'
          ? `${MOCK_SIGNATURE_PREFIX}${base64url(message)}`
          : await signMessageWithWallet(message, { address });

      if (signature === null) {
        setUnsupported(true);
        return;
      }

      setResult(await verifyPoc(challenge, signature));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const connected = status === 'connected' && Boolean(address);

  return (
    <section className="card p-6">
      <h2 className="section-title">{t('identity.poc.title')}</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-muted">
        {t('identity.poc.body')}
      </p>

      {!did ? (
        <p className="well mt-5 p-3 text-sm text-fg-muted">{t('identity.poc.needDid')}</p>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void request()}
              disabled={busy !== null}
              className="btn btn-outline btn-sm"
            >
              {busy === 'challenge' ? t('common.loading') : t('identity.poc.getChallenge')}
            </button>
            <button
              type="button"
              onClick={() => void proveIt()}
              disabled={busy !== null || !challenge || (mode === 'live' && !connected)}
              className="btn btn-primary btn-sm"
            >
              {busy === 'signing' ? t('common.loading') : t('identity.poc.sign')}
            </button>
          </div>

          {challenge ? (
            <pre className="well overflow-x-auto p-3 text-[11px] leading-relaxed text-fg-muted">
              {JSON.stringify(challenge, null, 2)}
            </pre>
          ) : null}

          {unsupported ? (
            <p className="text-xs leading-relaxed text-fg-subtle">
              {t('identity.poc.unsupported')}
            </p>
          ) : null}

          {result ? (
            <p
              className={`flex items-center gap-2 text-sm ${
                result.verified ? 'text-verde' : 'text-danger'
              }`}
            >
              {result.verified ? (
                <Check size={14} weight={ICON_WEIGHT} aria-hidden="true" />
              ) : (
                <X size={14} weight={ICON_WEIGHT} aria-hidden="true" />
              )}
              {result.verified
                ? t('identity.poc.verified')
                : // Each reason means something different to whoever is trying
                  // to log in, so each one is named rather than collapsed.
                  t(`identity.poc.reason.${result.reason ?? 'bad-signature'}`)}
            </p>
          ) : null}
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

/** base64url, no padding — what the verifier expects on the wire. */
function base64url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
