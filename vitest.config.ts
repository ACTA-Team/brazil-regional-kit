import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    // The suite must be runnable offline and in CI without credentials, so
    // nothing here touches Horizon or an anchor. Network-dependent behaviour is
    // covered by injecting a fake `fetch` instead.
    environment: 'node',
    coverage: {
      provider: 'v8',
      /*
       * The packages are the reusable surface — the part other people import,
       * and the part that moves money. `apps/hub` is deliberately not measured
       * here: it is a Next app whose every page and API route is exercised over
       * real HTTP by the `smoke` workflow, which catches more than a mounted
       * component test would. See QUALITY.md for the plan to add component
       * coverage on top of that.
       *
       * Two path segments, because packages are grouped under `kit` and
       * `anchors` — matching the workspace globs in pnpm-workspace.yaml.
       */
      include: ['packages/*/*/src/**/*.ts'],
      /*
       * `index.ts` files are re-export barrels with no logic of their own.
       * `styles.css`-generating scripts and the generated string table in
       * `ramp-ui` are build output, not behaviour.
       */
      exclude: ['**/*.test.ts', '**/index.ts', '**/*.generated.ts', '**/scripts/**'],
      reporter: ['text', 'lcov', 'json-summary'],
      /*
       * A floor, not a target. Measured at 87.5% statements / 79.8% branches /
       * 86.4% functions / 88.3% lines, so there is real headroom above every
       * number below — these exist to stop a regression, not to be scraped past.
       *
       * Raise them when the headroom grows; never lower one to make a build go
       * green.
       */
      thresholds: {
        statements: 80,
        functions: 80,
        lines: 80,
        branches: 75,
      },
    },
  },
});
