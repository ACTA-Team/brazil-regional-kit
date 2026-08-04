/**
 * One API, many anchors.
 *
 * The router takes a single request — "I have 500 BRL and I'm in Brazil" — asks
 * every adapter that plausibly serves it, in parallel, and returns what came
 * back ranked by what the user actually receives.
 *
 * Three design decisions carry most of the weight:
 *
 *  1. **A slow anchor must not hold up a fast one.** Every adapter gets its own
 *     deadline and the fan-out settles rather than races, so one hung anchor
 *     costs you its timeout, not the whole response.
 *  2. **A failing anchor is data, not an exception.** The result reports every
 *     anchor it consulted and why each one is absent — unsupported, timed out,
 *     amount out of range. A router that silently drops anchors is impossible
 *     to debug and impossible to trust.
 *  3. **Only comparable quotes are compared.** Ranking happens *within* a
 *     destination asset. Declaring "best" across MXN and BRL would be
 *     meaningless, so quotes are grouped and each group gets its own winner.
 */

import {
  compare,
  isRampError,
  supportsCorridor,
  toRampError,
  type AdapterCapabilities,
  type AdapterMode,
  type AssetId,
  type CountryCode,
  type Quote,
  type RampAdapter,
  type RampDirection,
  type RampErrorCode,
} from '@brk/ramp-core';

export interface RouteRequest {
  sellAsset: AssetId;
  /** Omit to ask "what can I get for this?" across every destination asset. */
  buyAsset?: AssetId;
  sellAmount: string;
  /** Narrows to anchors serving this country. */
  country?: CountryCode;
  direction?: RampDirection;
  account?: string;
  /** Per-anchor deadline. Past this, the anchor is reported as timed out. */
  timeoutMs?: number;
}

export type AnchorOutcome = 'quoted' | 'unsupported' | 'failed' | 'timeout';

export interface AnchorResult {
  anchorId: string;
  anchorName: string;
  mode: AdapterMode;
  outcome: AnchorOutcome;
  latencyMs: number;
  /** Present when `outcome` is not `quoted`. */
  reason?: string;
  errorCode?: RampErrorCode;
}

export interface RankedQuote extends Quote {
  /** Best quote for its destination asset. */
  best: boolean;
  /** Position within its destination-asset group, 1-based. */
  rank: number;
  /**
   * How many anchors quoted this destination asset. A "best" badge only means
   * something when this is greater than one — being the only quote for MXN is
   * not a win, and the UI should not dress it up as one.
   */
  groupSize: number;
  /** How much less this pays than the group's best, as a percentage string. */
  worseByPct?: string;
}

export interface RouteResult {
  quotes: RankedQuote[];
  /** Every anchor considered, including the ones that produced nothing. */
  anchors: AnchorResult[];
  elapsedMs: number;
  /** True when at least one quote came from a live anchor. */
  hasLiveQuote: boolean;
}

export interface RampRouterOptions {
  adapters: RampAdapter[];
  defaultTimeoutMs?: number;
}

export class RampRouter {
  private readonly adapters: RampAdapter[];
  private readonly defaultTimeoutMs: number;

  constructor(options: RampRouterOptions) {
    this.adapters = options.adapters;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 6_000;
  }

  /** Every anchor registered, whether or not it serves a given corridor. */
  capabilities(): AdapterCapabilities[] {
    return this.adapters.map((a) => a.capabilities());
  }

  /**
   * Which anchors could serve this request at all.
   *
   * When `buyAsset` is given the match is exact. When it is not, the request is
   * open-ended — "what can I get for 500 BRL in Brazil?" — and every corridor
   * selling that asset (in that country) qualifies. That second mode is what
   * makes this a router rather than a price comparison: it answers the question
   * a user in a country actually has.
   */
  private candidates(req: RouteRequest): Array<{ adapter: RampAdapter; buyAssets: AssetId[] }> {
    const out: Array<{ adapter: RampAdapter; buyAssets: AssetId[] }> = [];

    for (const adapter of this.adapters) {
      const caps = adapter.capabilities();

      if (req.buyAsset) {
        if (supportsCorridor(caps, { ...req, buyAsset: req.buyAsset })) {
          out.push({ adapter, buyAssets: [req.buyAsset] });
        }
        continue;
      }

      const buyAssets = [
        ...new Set(
          caps.corridors
            .filter(
              (c) =>
                c.sellAsset === req.sellAsset &&
                (!req.country || c.country === req.country) &&
                (!req.direction || c.direction === req.direction),
            )
            .map((c) => c.buyAsset),
        ),
      ];

      if (buyAssets.length) out.push({ adapter, buyAssets });
    }

    return out;
  }

  async route(req: RouteRequest): Promise<RouteResult> {
    const startedAt = Date.now();
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const candidates = this.candidates(req);

    const anchors: AnchorResult[] = [];
    const quotes: Quote[] = [];

    // Every (anchor, destination asset) pair is one independent request. They
    // all start together; none can block another.
    const tasks = candidates.flatMap(({ adapter, buyAssets }) =>
      buyAssets.map(async (buyAsset) => {
        const caps = adapter.capabilities();
        const attemptedAt = Date.now();

        try {
          const quote = await withTimeout(
            adapter.getQuote({
              sellAsset: req.sellAsset,
              buyAsset,
              sellAmount: req.sellAmount,
              country: req.country,
              account: req.account,
            }),
            timeoutMs,
          );

          quotes.push(quote);
          anchors.push({
            anchorId: caps.id,
            anchorName: caps.name,
            mode: caps.mode,
            outcome: 'quoted',
            latencyMs: quote.latencyMs,
          });
        } catch (e) {
          const err = isRampError(e) ? e : toRampError(e, caps.id);
          const timedOut = err.message === TIMEOUT_MESSAGE;

          anchors.push({
            anchorId: caps.id,
            anchorName: caps.name,
            mode: caps.mode,
            outcome: timedOut
              ? 'timeout'
              : err.code === 'UNSUPPORTED_PAIR' || err.code === 'AMOUNT_OUT_OF_RANGE'
                ? 'unsupported'
                : 'failed',
            latencyMs: Date.now() - attemptedAt,
            reason: timedOut ? `No response within ${timeoutMs}ms` : err.message,
            errorCode: err.code,
          });
        }
      }),
    );

    await Promise.allSettled(tasks);

    return {
      quotes: rank(quotes),
      anchors: anchors.sort(byOutcomeThenLatency),
      elapsedMs: Date.now() - startedAt,
      hasLiveQuote: quotes.some((q) => q.mode === 'live'),
    };
  }

  /** Convenience: the single best quote for an exact pair, or null. */
  async best(req: RouteRequest & { buyAsset: AssetId }): Promise<RankedQuote | null> {
    const result = await this.route(req);
    return result.quotes.find((q) => q.best) ?? null;
  }
}

// ── Ranking ───────────────────────────────────────────────────────────────────

/**
 * Group by destination asset, then order by how much the user receives.
 * Comparing a BRL payout against an MXN one would be nonsense, so "best" is
 * always relative to a group.
 */
export function rank(quotes: Quote[]): RankedQuote[] {
  const groups = new Map<AssetId, Quote[]>();
  for (const q of quotes) {
    const bucket = groups.get(q.buyAsset);
    if (bucket) bucket.push(q);
    else groups.set(q.buyAsset, [q]);
  }

  const ranked: RankedQuote[] = [];

  for (const bucket of groups.values()) {
    bucket.sort((a, b) => {
      const byAmount = compare(b.buyAmount, a.buyAmount);
      // Identical payouts: prefer a firm quote, then the faster anchor.
      if (byAmount !== 0) return byAmount;
      if (a.firmness !== b.firmness) return a.firmness === 'firm' ? -1 : 1;
      return a.latencyMs - b.latencyMs;
    });

    const top = bucket[0];
    bucket.forEach((quote, index) => {
      ranked.push({
        ...quote,
        best: index === 0,
        rank: index + 1,
        groupSize: bucket.length,
        worseByPct: index === 0 || !top ? undefined : percentBelow(top.buyAmount, quote.buyAmount),
      });
    });
  }

  // Live quotes first across groups, so a real anchor leads the table.
  return ranked.sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === 'live' ? -1 : 1;
    if (a.best !== b.best) return a.best ? -1 : 1;
    return a.rank - b.rank;
  });
}

function percentBelow(best: string, value: string): string {
  const top = Number(best);
  const current = Number(value);
  if (!Number.isFinite(top) || top <= 0) return '0';
  return (((top - current) / top) * 100).toFixed(2);
}

const OUTCOME_ORDER: Record<AnchorOutcome, number> = {
  quoted: 0,
  unsupported: 1,
  timeout: 2,
  failed: 3,
};

function byOutcomeThenLatency(a: AnchorResult, b: AnchorResult): number {
  const byOutcome = OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome];
  return byOutcome !== 0 ? byOutcome : a.latencyMs - b.latencyMs;
}

// ── Timeout ───────────────────────────────────────────────────────────────────

const TIMEOUT_MESSAGE = 'brk-router-timeout';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMEOUT_MESSAGE)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export function createRampRouter(options: RampRouterOptions): RampRouter {
  return new RampRouter(options);
}
