import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * Load the workspace-root `.env` files.
 *
 * Next only looks for `.env.local` beside the app — `apps/hub/.env.local` — but
 * the CLI scripts read it from the repository root. Left alone, that split means
 * `pnpm diagnose` cheerfully reports the Etherfuse key as present while the app
 * silently falls back to mock mode, and the two disagree about whether the demo
 * is live. That is a genuinely nasty way to lose an hour.
 *
 * So: one file, at the root, read by everything.
 *
 * This runs before Next resolves the config, which is early enough for
 * `NEXT_PUBLIC_*` values to reach the client bundle.
 */
function loadWorkspaceEnv(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  // Later files win, matching Next's own precedence.
  for (const file of ['.env', '.env.local']) {
    const path = join(root, file);
    if (!existsSync(path)) continue;

    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;

      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // A real environment variable always wins — that is how CI overrides work,
      // and how a Vercel dashboard value beats a committed file.
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadWorkspaceEnv();

const nextConfig: NextConfig = {
  /**
   * Workspace packages ship as TypeScript source rather than pre-built bundles,
   * so Next compiles them alongside the app. Editing `@brk/ramp-core` hot-reloads
   * the hub with no build step in between — worth a lot while iterating.
   */
  transpilePackages: [
    '@brk/ramp-core',
    '@brk/ramp-ui',
    '@brk/adapter-etherfuse',
    '@brk/adapter-sep',
    '@brk/ramp-router',
    '@brk/stablecoin-kit',
  ],
  typedRoutes: false,
};

export default nextConfig;
