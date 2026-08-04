'use client';

/**
 * Quote → order → settle, shared by the on-ramp and the off-ramp.
 *
 * Both directions run the same lifecycle against the same adapter interface;
 * only the assets and the user's action in the middle differ. Keeping the
 * lifecycle here means expiry handling, polling and error normalization are
 * written once and behave identically on both pages.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminal, type AssetId, type CountryCode } from '@brk/ramp-core';
import {
  ApiError,
  createOrder as createOrderCall,
  fetchOrder,
  requestQuote,
  simulateLeg,
  type PublicOrder,
  type PublicQuote,
} from '@/client/api';

/**
 * Etherfuse rejects a duplicate pending order keyed on (bank account, amount)
 * and offers no cancel endpoint, so this is worth recognising precisely.
 */
function isDuplicateOrder(e: unknown): boolean {
  return (
    e instanceof ApiError && e.code === 'INVALID_ORDER_STATE' && /already exists/i.test(e.message)
  );
}

/** A few centavos is enough to clear the collision without moving the price. */
function nudgeAmount(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return amount;
  return (value + 0.01 + Math.random() * 0.9).toFixed(2);
}

export type FlowStage = 'input' | 'quoted' | 'ordered' | 'done';

export interface RampFlowOptions {
  anchorId: string;
  sellAsset: AssetId;
  buyAsset: AssetId;
  country?: CountryCode;
  /** Poll interval while the order is not terminal. */
  pollMs?: number;
}

export interface RampFlowState {
  stage: FlowStage;
  quote: PublicQuote | null;
  order: PublicOrder | null;
  busy: null | 'quoting' | 'ordering' | 'simulating' | 'polling';
  error: ApiError | Error | null;
  /** Set when a duplicate-order collision forced the amount to change. */
  adjustedAmount: string | null;

  getQuote: (sellAmount: string, account?: string) => Promise<void>;
  confirm: (account: string) => Promise<void>;
  simulate: (leg: 'fiat' | 'crypto') => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

export function useRampFlow(options: RampFlowOptions): RampFlowState {
  const { anchorId, sellAsset, buyAsset, country, pollMs = 2500 } = options;

  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [busy, setBusy] = useState<RampFlowState['busy']>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  // Remembered so `getQuote` can be re-run on expiry without the page re-passing them.
  const lastRequest = useRef<{ amount: string; account?: string } | null>(null);
  /** Guards the duplicate-order retry, so a genuine failure cannot loop. */
  const retriedRef = useRef(false);
  /** Set when the amount had to be nudged, so the UI can say so. */
  const [adjustedFrom, setAdjustedFrom] = useState<string | null>(null);

  const stage: FlowStage = order
    ? isTerminal(order.status)
      ? 'done'
      : 'ordered'
    : quote
      ? 'quoted'
      : 'input';

  const getQuote = useCallback(
    async (sellAmount: string, account?: string) => {
      setBusy('quoting');
      setError(null);
      lastRequest.current = { amount: sellAmount, account };
      try {
        const { quote: next } = await requestQuote({
          anchorId,
          sellAsset,
          buyAsset,
          sellAmount,
          account,
          country,
        });
        setQuote(next);
      } catch (e) {
        setError(e as Error);
      } finally {
        setBusy(null);
      }
    },
    [anchorId, sellAsset, buyAsset, country],
  );

  const confirm = useCallback(
    async (account: string) => {
      if (!quote) return;
      setBusy('ordering');
      setError(null);

      try {
        const { order: next } = await createOrderCall({ anchorId, quoteId: quote.id, account });
        setOrder(next);
        return;
      } catch (e) {
        // A quote that expired between display and confirmation is routine, not
        // a failure: re-quote silently and let the user press confirm again.
        if (e instanceof ApiError && e.code === 'QUOTE_EXPIRED' && lastRequest.current) {
          setQuote(null);
          await getQuote(lastRequest.current.amount, lastRequest.current.account);
          setError(e);
          setBusy(null);
          return;
        }

        /*
         * Etherfuse refuses a second pending order for the same bank account
         * and amount, and gives you no way to cancel the first — so a sandbox
         * littered with test orders can block round numbers like 250 or 500
         * permanently. Nudging the amount by a few centavos and retrying once
         * is what a person would do by hand; doing it for them keeps a
         * bookkeeping quirk from looking like a broken integration.
         */
        if (isDuplicateOrder(e) && lastRequest.current && !retriedRef.current) {
          retriedRef.current = true;
          const nudged = nudgeAmount(lastRequest.current.amount);

          try {
            const { quote: requoted } = await requestQuote({
              anchorId,
              sellAsset,
              buyAsset,
              sellAmount: nudged,
              account: lastRequest.current.account,
              country,
            });
            const { order: next } = await createOrderCall({
              anchorId,
              quoteId: requoted.id,
              account,
            });

            lastRequest.current = { ...lastRequest.current, amount: nudged };
            setQuote(requoted);
            setOrder(next);
            // The UI needs the amount actually charged, so the user is never
            // surprised by a total they did not type.
            setAdjustedFrom(nudged);
            return;
          } catch (retryError) {
            setError(retryError as Error);
            return;
          } finally {
            setBusy(null);
          }
        }

        setError(e as Error);
      } finally {
        setBusy(null);
      }
    },
    [anchorId, quote, getQuote, sellAsset, buyAsset, country],
  );

  const refresh = useCallback(async () => {
    if (!order) return;
    try {
      const { order: next } = await fetchOrder(order.id, anchorId);
      setOrder(next);
    } catch (e) {
      setError(e as Error);
    }
  }, [anchorId, order]);

  const simulate = useCallback(
    async (leg: 'fiat' | 'crypto') => {
      if (!order) return;
      setBusy('simulating');
      setError(null);
      try {
        const { order: next } = await simulateLeg(order.id, leg, anchorId);
        setOrder(next);
      } catch (e) {
        setError(e as Error);
      } finally {
        setBusy(null);
      }
    },
    [anchorId, order],
  );

  // Poll until terminal. Etherfuse needs a few seconds before an order is even
  // readable, so a transient failure here is ignored rather than surfaced.
  useEffect(() => {
    if (!order || isTerminal(order.status)) return;

    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const { order: next } = await fetchOrder(order.id, anchorId);
        if (!cancelled) setOrder(next);
      } catch {
        /* keep polling — the anchor may just be indexing */
      }
    }, pollMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [order, anchorId, pollMs]);

  const reset = useCallback(() => {
    retriedRef.current = false;
    setAdjustedFrom(null);
    setQuote(null);
    setOrder(null);
    setError(null);
    setBusy(null);
    lastRequest.current = null;
  }, []);

  return {
    stage,
    quote,
    order,
    busy,
    error,
    adjustedAmount: adjustedFrom,
    getQuote,
    confirm,
    simulate,
    refresh,
    reset,
    clearError: () => setError(null),
  };
}
