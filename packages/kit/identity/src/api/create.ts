/**
 * One factory, so nothing above this line branches on mode.
 *
 * Same precedence as every adapter in the kit — explicit → `IDENTITY_MODE` →
 * `RAMP_MODE` → mock — and the same degradation rule: asking for `live` without
 * the credentials that make `live` possible gets you a labelled mock instead of
 * a runtime failure on the first click.
 */

import { resolveMode } from '@brk/ramp-core';
import type { IdentityApi, IdentityMode } from './api';
import { ActaIdentityClient, type IdentityClientOptions } from './client';
import { MockIdentityApi } from './mock';

export interface IdentityApiOptions extends IdentityClientOptions {
  /** Wins over both env vars. */
  mode?: IdentityMode;
  /** Value of `IDENTITY_MODE`. */
  adapterEnv?: string;
  /** Value of `RAMP_MODE`. */
  globalEnv?: string;
}

export function createIdentityApi(opts: IdentityApiOptions = {}): IdentityApi {
  const mode = resolveMode({
    explicit: opts.mode,
    adapterEnv: opts.adapterEnv,
    globalEnv: opts.globalEnv,
    // Resolution is unauthenticated, but credentials are not, and eligibility
    // needs to verify one. Without a key, `live` could only do half the job.
    liveAvailable: Boolean(opts.apiKey),
  });

  return mode === 'live' ? new ActaIdentityClient(opts) : new MockIdentityApi(opts.network);
}
