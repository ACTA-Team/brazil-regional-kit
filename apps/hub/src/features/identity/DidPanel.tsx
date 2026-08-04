'use client';

import { useState } from 'react';
import { ErrorAlert } from '@/components/feedback/ErrorAlert';
import { Check, ICON_WEIGHT } from '@/components/icons';
import { claimDid, forgetDid, prepareDid, submitDid, type DidResolution } from '@/client/identity';
import { useI18n } from '@/client/i18n';
import { useWallet } from '@/client/wallet';
import { shortAddress } from '@/client/wallet';

/**
 * Mint a did:stellar, or claim one you already have.
 *
 * The wallet signs its own registration because the wallet is the controller —
 * the hub holds no key that could create or mutate somebody else's identity. In
 * mock mode there is no transaction at all, so the marker goes straight back
 * without a signature prompt, which is the honest shape of "nothing happened".
 */
export function DidPanel({
  mode,
  resolution,
  onChange,
}: {
  mode: 'live' | 'mock';
  resolution: DidResolution | null;
  onChange: (next: DidResolution | null) => void;
}) {
  const { t } = useI18n();
  const { address, sign, status } = useWallet();

  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState('');
  const [notMine, setNotMine] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const connected = status === 'connected' && Boolean(address);

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareDid(address);

      // Mock mode hands back a marker, not a transaction. Asking a wallet to
      // sign it would prompt for a signature over a string that means nothing.
      const signed = prepared.mode === 'mock' ? prepared.xdr : await sign(prepared.xdr);

      await submitDid(signed, prepared.did);
      onChange(await claimDid(prepared.did, address));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const claim = async () => {
    setBusy(true);
    setError(null);
    setNotMine(false);
    try {
      const claimed = await claimDid(pasted.trim(), address);
      // Null means it resolved but this wallet is not its controller — a
      // different message from "that is not a DID", and the user needs to know
      // which of the two happened.
      if (!claimed) setNotMine(true);
      else {
        onChange(claimed);
        setPasted('');
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    forgetDid();
    onChange(null);
  };

  return (
    <section className="card card-glow p-6">
      <h2 className="section-title">{t('identity.did.title')}</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-muted">
        {t('identity.did.body')}
      </p>

      {!connected ? (
        <p className="well mt-5 p-3 text-sm text-fg-muted">{t('identity.did.connectFirst')}</p>
      ) : resolution ? (
        <div className="mt-5 space-y-3">
          <div className="well p-3">
            <p className="label">{t('identity.did.yours')}</p>
            <code className="mt-1 block break-all text-xs text-success">{resolution.did}</code>
          </div>
          <p className="flex items-center gap-2 text-xs text-fg-muted">
            <Check size={13} weight={ICON_WEIGHT} className="text-verde" aria-hidden="true" />
            {t('identity.did.controlledBy', { address: shortAddress(address) })}
          </p>
          <button type="button" onClick={disconnect} className="btn btn-link btn-sm">
            {t('identity.did.forget')}
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <button
            type="button"
            onClick={() => void register()}
            disabled={busy}
            className="btn btn-primary"
          >
            {busy ? t('common.loading') : t('identity.did.register')}
          </button>

          {/*
            The paste box is not a convenience — it is the only way back.
            The registry is keyed by DID, so nothing can look up "which DID does
            this wallet control". Clear the browser and the DID has to come from
            wherever the user kept it.
          */}
          <div>
            <p className="label">{t('identity.did.alreadyHave')}</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-subtle">
              {t('identity.did.noLookup')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="did:stellar:testnet:…"
                spellCheck={false}
                className="well min-w-64 flex-1 bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-gold/40"
              />
              <button
                type="button"
                onClick={() => void claim()}
                disabled={busy || !pasted.trim()}
                className="btn btn-outline btn-sm"
              >
                {t('identity.did.claim')}
              </button>
            </div>
            {notMine ? (
              <p className="mt-2 text-xs text-danger">{t('identity.did.notYours')}</p>
            ) : null}
          </div>
        </div>
      )}

      {mode === 'mock' ? (
        <p className="mt-5 text-xs leading-relaxed text-fg-subtle">{t('identity.did.mockNote')}</p>
      ) : null}

      {error ? (
        <div className="mt-4">
          <ErrorAlert error={error} />
        </div>
      ) : null}
    </section>
  );
}
