import 'server-only';

/**
 * Server-side anchor registry and router.
 *
 * Adapters are singletons because they hold per-session state (Etherfuse quote
 * context, mock order stores, SEP discovery caches) that must survive between
 * API requests. The cache hangs off `globalThis` so Next's dev hot-reload does
 * not silently drop in-flight orders every time a component is edited.
 *
 * This module is `server-only`: the Etherfuse API key lives here and must never
 * be bundled into the browser.
 */

import { createEtherfuseAdapter, type EtherfuseAdapter } from '@brk/adapter-etherfuse';
import { createKoyweAdapter, createMantecaAdapter } from '@brk/adapter-mocks';
import { createSepAdapter, type SepAnchorAdapter } from '@brk/adapter-sep';
import { createRampRouter, type RampRouter } from '@brk/ramp-router';
import { resolveMode, type AdapterMode, type RampAdapter } from '@brk/ramp-core';

export interface AnchorRegistry {
  etherfuse: EtherfuseAdapter;
  sep: SepAnchorAdapter;
  all: RampAdapter[];
  router: RampRouter;
  /**
   * Resolves once SEP discovery has been attempted. Until then the SEP anchor
   * reports no corridors and the router would skip it — so anything that needs
   * the full anchor set awaits this first.
   */
  ready: Promise<void>;
}

/**
 * Bump when the registry's shape changes. The cache deliberately outlives a hot
 * reload — that is the point, it keeps in-flight orders alive — which also means
 * a stale object from the previous shape would survive and blow up at the first
 * property access. Versioning the key makes an edit to this file rebuild it.
 */
const REGISTRY_KEY = Symbol.for('brk.anchors.registry.v2');
const scope = globalThis as unknown as Record<symbol, AnchorRegistry | undefined>;

export function etherfuseMode(): AdapterMode {
  return resolveMode({
    adapterEnv: process.env.ETHERFUSE_MODE,
    globalEnv: process.env.RAMP_MODE,
    // A `live` request with no key would fail on every call; degrade instead.
    liveAvailable: Boolean(process.env.ETHERFUSE_API_KEY),
  });
}

/**
 * The SEP anchor needs no credentials — SEP-38 price endpoints are
 * unauthenticated — so it can be live even in a zero-config clone. It only
 * drops to mock if explicitly asked.
 */
export function sepMode(): AdapterMode {
  return resolveMode({
    adapterEnv: process.env.SEP_MODE,
    globalEnv: process.env.SEP_MODE ? undefined : 'live',
  });
}

function build(): AnchorRegistry {
  const etherfuse = createEtherfuseAdapter({
    mode: etherfuseMode(),
    apiKey: process.env.ETHERFUSE_API_KEY,
    baseUrl: process.env.ETHERFUSE_BASE_URL,
    customerId: process.env.ETHERFUSE_CUSTOMER_ID,
    bankAccountId: process.env.ETHERFUSE_BANK_ACCOUNT_ID,
  });

  const sep = createSepAdapter({
    mode: sepMode(),
    homeDomain: process.env.SEP_ANCHOR_HOME_DOMAIN ?? 'testanchor.stellar.org',
    id: 'testanchor',
    name: 'SDF Test Anchor',
    defaultCountry: 'US',
  });

  const all: RampAdapter[] = [etherfuse, sep, createMantecaAdapter(), createKoyweAdapter()];

  // Discovery failure is survivable: the SEP anchor simply contributes nothing
  // and the rest of the router keeps working. Never let it reject.
  const ready = sep
    .discover()
    .then(() => undefined)
    .catch((e: unknown) => {
      console.warn('[brk] SEP discovery failed:', e instanceof Error ? e.message : e);
    });

  return {
    etherfuse,
    sep,
    all,
    router: createRampRouter({ adapters: all, defaultTimeoutMs: 6_000 }),
    ready,
  };
}

export function anchors(): AnchorRegistry {
  const existing = scope[REGISTRY_KEY];
  // Belt and braces alongside the version bump: never trust a cached object
  // that does not have what callers are about to reach for.
  if (existing?.router && existing.all?.length) return existing;
  const created = build();
  scope[REGISTRY_KEY] = created;
  return created;
}

/** Await before routing, so the SEP anchor is in the running. */
export async function readyAnchors(): Promise<AnchorRegistry> {
  const registry = anchors();
  await registry.ready;
  return registry;
}

/** Look an adapter up by the `anchorId` carried on every quote and order. */
export function anchorById(id: string): RampAdapter {
  const found = anchors().all.find((a) => a.capabilities().id === id);
  if (!found) throw new Error(`Unknown anchor "${id}"`);
  return found;
}

/** Drop the cache so the next request rebuilds against changed env. */
export function resetAnchors(): void {
  scope[REGISTRY_KEY] = undefined;
}
