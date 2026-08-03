/**
 * SEP-1 stellar.toml discovery.
 *
 * A deliberately small TOML reader rather than a dependency: stellar.toml uses a
 * tiny slice of the format — scalars, string arrays, `[TABLE]` and `[[ARRAY]]`
 * sections — and the whole point of SEP-1 is that a client can bootstrap an
 * anchor from nothing but its domain. Carrying a general-purpose TOML parser to
 * read fifteen keys would be the wrong trade.
 */

import { RampError } from '@brk/ramp-core';

export interface TomlCurrency {
  code?: string;
  issuer?: string;
  status?: string;
  desc?: string;
  is_asset_anchored?: boolean;
  [key: string]: unknown;
}

export interface StellarToml {
  VERSION?: string;
  NETWORK_PASSPHRASE?: string;
  SIGNING_KEY?: string;
  ACCOUNTS?: string[];
  WEB_AUTH_ENDPOINT?: string;
  KYC_SERVER?: string;
  TRANSFER_SERVER?: string;
  TRANSFER_SERVER_SEP0024?: string;
  DIRECT_PAYMENT_SERVER?: string;
  ANCHOR_QUOTE_SERVER?: string;
  CURRENCIES?: TomlCurrency[];
  [key: string]: unknown;
}

function coerce(raw: string): unknown {
  const value = raw.trim();

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => coerce(part));
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function parseStellarToml(source: string): StellarToml {
  const root: StellarToml = {};
  // Where subsequent `key = value` lines land — the root, a table, or the last
  // element pushed onto an array-of-tables.
  let target: Record<string, unknown> = root as Record<string, unknown>;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const arraySection = trimmed.match(/^\[\[([^\]]+)\]\]$/);
    if (arraySection?.[1]) {
      const name = arraySection[1].trim();
      const bucket = ((root as Record<string, unknown>)[name] ??= []) as Record<string, unknown>[];
      const entry: Record<string, unknown> = {};
      bucket.push(entry);
      target = entry;
      continue;
    }

    const tableSection = trimmed.match(/^\[([^\]]+)\]$/);
    if (tableSection?.[1]) {
      const name = tableSection[1].trim();
      const table = ((root as Record<string, unknown>)[name] ??= {}) as Record<string, unknown>;
      target = table;
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    // Strip trailing comments, but not a `#` that lives inside a quoted string.
    const rest = trimmed.slice(eq + 1);
    const value = /^\s*["']/.test(rest) ? rest : rest.split('#')[0]!;
    target[key] = coerce(value);
  }

  return root;
}

const cache = new Map<string, { toml: StellarToml; fetchedAt: number }>();
const TTL_MS = 5 * 60_000;

/** Fetch and cache `https://<domain>/.well-known/stellar.toml`. */
export async function fetchStellarToml(
  homeDomain: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<StellarToml> {
  const domain = homeDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const cached = cache.get(domain);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.toml;

  const url = `https://${domain}/.well-known/stellar.toml`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000);

  try {
    const response = await (opts.fetchImpl ?? fetch)(url, { signal: controller.signal });
    if (!response.ok) {
      throw new RampError({
        code: 'ANCHOR_UNAVAILABLE',
        message: `${url} returned ${response.status}`,
        status: response.status,
      });
    }
    const toml = parseStellarToml(await response.text());
    cache.set(domain, { toml, fetchedAt: Date.now() });
    return toml;
  } catch (cause) {
    if (cause instanceof RampError) throw cause;
    throw new RampError({
      code: 'ANCHOR_UNAVAILABLE',
      message: `Could not read ${url}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  } finally {
    clearTimeout(timer);
  }
}
