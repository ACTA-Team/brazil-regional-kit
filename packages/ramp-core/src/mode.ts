/**
 * Mode resolution: per-adapter override → global → default.
 *
 * The default is `mock` on purpose. A judge who clones this repo with no
 * credentials should get a working demo on the first `pnpm dev`, and our own
 * live demo should never be one flaky sandbox away from having nothing to show.
 */

import type { AdapterMode } from './types';

export const DEFAULT_MODE: AdapterMode = 'mock';

function normalize(value: string | undefined): AdapterMode | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  return v === 'live' || v === 'mock' ? v : undefined;
}

export interface ResolveModeInput {
  /** Explicit value passed to the adapter factory. Wins over everything. */
  explicit?: AdapterMode;
  /** Value of the adapter's own env var, e.g. `ETHERFUSE_MODE`. */
  adapterEnv?: string;
  /** Value of `RAMP_MODE`. */
  globalEnv?: string;
  /**
   * Set false when required credentials are missing: a `live` request that
   * cannot possibly work degrades to `mock` instead of failing at request time.
   */
  liveAvailable?: boolean;
}

export function resolveMode(input: ResolveModeInput): AdapterMode {
  const wanted =
    input.explicit ?? normalize(input.adapterEnv) ?? normalize(input.globalEnv) ?? DEFAULT_MODE;

  if (wanted === 'live' && input.liveAvailable === false) return 'mock';
  return wanted;
}
