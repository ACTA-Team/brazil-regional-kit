/**
 * Quoting from an anchor's published fee schedule.
 *
 * SEP-38 is the clean way to ask an anchor for a price, and almost nobody
 * implements it. Probing the ecosystem's live anchors found exactly one public
 * SEP-38 quote server, while several real regional anchors publish a complete,
 * unauthenticated SEP-24 or SEP-6 `/info`: the assets they serve, the limits,
 * and their fee schedule.
 *
 * That is enough to quote honestly. These anchors issue pegged assets — Anclap's
 * ARS token is one Argentine peso — so a deposit of X fiat yields X minus the
 * anchor's own published fee. Nothing is estimated and nothing is invented; the
 * numbers are the anchor's terms, fetched live, applied by arithmetic anyone can
 * check.
 *
 * The distinction that matters for honesty: these quotes are `indicative`. They
 * are real published terms, not a reserved price the anchor has committed to.
 * Only SEP-38 `/quote` produces a firm one.
 */

import { stripTrailingSlashes } from '@brk/ramp-core';

/** One asset as an anchor's `/info` describes it. */
export interface FeeScheduleEntry {
  code: string;
  enabled: boolean;
  minAmount?: string;
  maxAmount?: string;
  /** Flat fee in units of the asset. */
  feeFixed?: number;
  /** Percentage fee, as published (1 means 1%). */
  feePercent?: number;
}

export interface FeeSchedule {
  deposit: FeeScheduleEntry[];
  withdraw: FeeScheduleEntry[];
}

interface RawEntry {
  enabled?: boolean;
  min_amount?: number | string;
  max_amount?: number | string;
  fee_fixed?: number | string;
  fee_percent?: number | string;
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const str = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : String(v);

function parseSide(raw: Record<string, RawEntry> | undefined): FeeScheduleEntry[] {
  if (!raw) return [];
  return Object.entries(raw)
    .filter(([, cfg]) => cfg?.enabled !== false)
    .map(([code, cfg]) => ({
      code,
      enabled: cfg.enabled !== false,
      minAmount: str(cfg.min_amount),
      maxAmount: str(cfg.max_amount),
      feeFixed: num(cfg.fee_fixed),
      feePercent: num(cfg.fee_percent),
    }));
}

/**
 * Read `/info` from a SEP-24 or SEP-6 transfer server.
 *
 * Returns null rather than throwing: an anchor that does not answer is one the
 * router should report as unreachable, not one that should fail the request.
 *
 * `fetchImpl` is injected for the same reason every other client in this kit
 * takes one — without it this call escapes to a real anchor, which makes the
 * adapter above impossible to test hermetically and puts a third party in the
 * path of the suite.
 */
export async function fetchFeeSchedule(
  transferServer: string,
  timeoutMs = 8000,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<FeeSchedule | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${stripTrailingSlashes(transferServer)}/info`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;

    const text = await response.text();
    // Anchors under load answer with an HTML error page more often than anyone
    // would like; treating that as "no schedule" beats a parser exception.
    if (!text.trim().startsWith('{')) return null;

    const json = JSON.parse(text) as {
      deposit?: Record<string, RawEntry>;
      withdraw?: Record<string, RawEntry>;
    };

    return { deposit: parseSide(json.deposit), withdraw: parseSide(json.withdraw) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface FeeQuoteResult {
  /** What the customer receives, after the anchor's published fee. */
  buyAmount: string;
  /** The fee itself, in units of the amount supplied. */
  fee: string;
}

/**
 * Apply a published fee schedule to an amount.
 *
 * Returns null when the amount falls outside the anchor's own limits, because
 * quoting a number the anchor would reject is worse than saying it does not
 * serve this size.
 */
export function quoteFromSchedule(entry: FeeScheduleEntry, amount: string): FeeQuoteResult | null {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;

  const min = entry.minAmount === undefined ? undefined : Number(entry.minAmount);
  const max = entry.maxAmount === undefined ? undefined : Number(entry.maxAmount);
  if (min !== undefined && Number.isFinite(min) && value < min) return null;
  if (max !== undefined && Number.isFinite(max) && value > max) return null;

  const fee = (entry.feeFixed ?? 0) + value * ((entry.feePercent ?? 0) / 100);
  const received = value - fee;
  if (received <= 0) return null;

  return { buyAmount: received.toFixed(7), fee: fee.toFixed(7) };
}
