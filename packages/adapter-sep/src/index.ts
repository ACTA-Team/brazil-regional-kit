/**
 * @brk/adapter-sep — a ramp adapter for any SEP-compliant Stellar anchor.
 *
 * SEP-1 discovery, SEP-38 quotes (unauthenticated), SEP-10 authentication and
 * SEP-24 interactive entry points. Point it at a home domain and it works; the
 * default is SDF's public test anchor, which needs no credentials at all.
 */

export * from './toml';
export * from './sep38';
export * from './sep10';
export * from './adapter';

export { createSepFeeAdapter, SepFeeAnchorAdapter, type SepFeeAdapterConfig } from './fee-adapter';
export {
  fetchFeeSchedule,
  quoteFromSchedule,
  type FeeSchedule,
  type FeeScheduleEntry,
} from './fees';
