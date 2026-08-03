import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Workspace packages ship as TypeScript source rather than pre-built bundles,
   * so Next compiles them alongside the app. Editing `@brk/ramp-core` hot-reloads
   * the hub with no build step in between — worth a lot while iterating.
   */
  transpilePackages: [
    '@brk/ramp-core',
    '@brk/adapter-etherfuse',
    '@brk/adapter-sep',
    '@brk/adapter-mocks',
    '@brk/ramp-router',
    '@brk/stablecoin-kit',
  ],
  typedRoutes: false,
};

export default nextConfig;
