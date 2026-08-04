# Quality controls

Every check that runs against this repository, how to run it locally, and what it
means when it fails.

Rules for people (and agents) changing the code live in [AGENTS.md](AGENTS.md).

## The short version

```bash
pnpm install --frozen-lockfile   # reproducible install from the lockfile
pnpm verify                      # everything below, in order
```

`pnpm verify` runs: `format:check` → `lint` → `typecheck` → `test:coverage` →
`build` → `audit:check`. It is the same set CI runs, so a green `verify` locally
means a green pipeline.

## The tools

| Concern | Tool | Config |
| --- | --- | --- |
| Formatting | Prettier 3 | `.prettierrc.json`, `.prettierignore` |
| Linting | ESLint 10 flat config + typescript-eslint | `eslint.config.mjs` |
| Types | TypeScript 5.7, `strict` + `noUncheckedIndexedAccess` | `tsconfig.base.json` |
| Unit tests | Vitest 4 | `vitest.config.ts` |
| Coverage | `@vitest/coverage-v8` | `vitest.config.ts` |
| Integration / E2E | GitHub Actions + `curl` against the running app | `.github/workflows/smoke.yml` |
| Mutation testing | Stryker 9 | `stryker.config.json` |
| Dependency audit | `pnpm audit` + reviewed baseline | `scripts/audit.ts`, `security/audit-baseline.json` |
| Secret scanning | Gitleaks, plus repo-specific greps | `.github/workflows/security.yml` |
| Static analysis | CodeQL (`security-extended`) | `.github/workflows/codeql.yml` |
| Dependency updates | Dependabot, grouped | `.github/dependabot.yml` |
| Pre-commit | Husky + lint-staged | `.husky/pre-commit` |
| Pre-push | Husky | `.husky/pre-push` |

Node ≥20 (CI uses 22), pnpm 11.20.0 pinned via `packageManager`.

## Commands

### Install

```bash
pnpm install --frozen-lockfile
```

Fails rather than silently updating if `pnpm-lock.yaml` and the manifests disagree
— which is exactly what you want in CI.

### Formatting

```bash
pnpm format          # rewrite files
pnpm format:check    # report only, never writes — this is what CI runs
```

### Linting

```bash
pnpm lint
pnpm lint:fix
```

ESLint is configured to catch real problems rather than style: unused variables
and arguments (`_`-prefixed are intentional), `any` (an error, not a warning),
`==` outside null checks, `var`, and React hook dependency mistakes in the hub.
Formatting rules are left entirely to Prettier via `eslint-config-prettier`, so
the two never disagree.

### Types

```bash
pnpm typecheck
```

Two passes: the root `tsconfig.json` covers `scripts/`, then every workspace
package and app is checked in parallel. Test files are typechecked too — a test
that does not compile is not a test.

### Tests

```bash
pnpm test            # once
pnpm test:watch      # while working
pnpm test:coverage   # once, with coverage and threshold enforcement
```

**369 tests across 20 files.** The suite is hermetic: no network, no anchor, no
Horizon, no credentials. It passes on a fresh clone with no `.env`. Anything that
would reach the network takes an injected `fetch` or is stubbed at the module
boundary, so a third party being down can never turn the build red.

### Coverage

```bash
pnpm test:coverage
```

Current, measured:

| Metric | Threshold | Actual |
| --- | --- | --- |
| Statements | 80% | **87.53%** (913/1043) |
| Branches | 75% | **79.92%** (613/767) |
| Functions | 80% | **86.40%** (197/228) |
| Lines | 80% | **88.27%** (821/930) |

The build fails below any threshold. The gap between threshold and actual is
deliberate headroom — the numbers exist to stop a regression, not to be scraped
past. Raise them as the headroom grows; never lower one to make a build green.

Scope is `packages/*/src` — the reusable surface other people import. `index.ts`
barrels are excluded because they are re-exports with no logic.

**`apps/hub` is not in the coverage number.** It is a Next app whose every page
and API route is exercised over real HTTP by the `smoke` workflow, which catches
more than a mounted-component test would. That is a real gap in one direction —
component logic and error rendering are not unit tested. Closing it means adding
`jsdom` and Testing Library; the honest ramp is below.

Per-file, the weakest points today:

| File | Lines | Why |
| --- | --- | --- |
| `stablecoin-kit/wallet.ts` | 37% | Browser wallet extensions. The server-safety contract is tested; the in-browser paths need a real extension. |
| `adapter-etherfuse/adapter.ts` | 72% | Order-polling branches against the live sandbox. |
| `adapter-etherfuse/mock.ts` | 79% | Fixture replay edge cases. |

Suggested ramp, in value order: hub API-route handlers (pure functions given a
`Request`) → Etherfuse adapter order lifecycle → hub components under jsdom.
Raise thresholds after each step rather than in advance.

### Integration and end-to-end

There is no separate local E2E command — the end-to-end check is a CI workflow,
because it needs the app built and served. To run what it runs:

```bash
pnpm build
pnpm start &
npx wait-on http://localhost:3000

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/onramp
curl -sf "http://localhost:3000/api/quotes?sell=iso4217:BRL&amount=500&country=BR"
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/premium-fx   # expect 402
```

`.github/workflows/smoke.yml` does this with **no environment block at all** —
the exact state of a fresh clone. It asserts that every page returns 200, all
four anchors register, the multi-anchor quote endpoint answers, a single-anchor
quote round-trips, and that x402 challenges an unpaid request and refuses a
forged payment proof. If that workflow fails, the quickstart in the README is a
lie.

No test anywhere talks to a production service or uses real credentials. There is
no database, so there is no test data to clean up: order state lives in memory
and in `localStorage`.

### Mutation testing

```bash
pnpm test:mutation
```

Coverage says a line ran. It does not say an assertion would have noticed if that
line were wrong — and in a kit that computes what a person receives for their
money, that is the gap that matters. Stryker rewrites the code in small ways (`>`
becomes `>=`, `+` becomes `-`) and reports which changes the suite fails to catch.

Scoped to the pure logic where it is cheap and most informative: `money.ts`,
`memo.ts`, `assets.ts`, `errors.ts` and `router.ts`.

Last run: **77.67%** mutation score (327 killed, 82 survived), ~47 seconds.
Per file: `money.ts` 90.53%, `memo.ts` 86.67%, `errors.ts` 82.98%, `assets.ts`
73.96%, `router.ts` 68.63%. Build threshold is 70%.

**Not run on pull requests** — it re-runs the suite once per mutant, which is too
slow to sit in front of every push. It runs weekly (`.github/workflows/
mutation.yml`) and on demand. Run it manually before a release, or after
substantially reworking any of the scoped files. The HTML report lands in
`reports/mutation/index.html`.

The surviving mutants in `router.ts` are the honest next target: ranking and
outcome-ordering are under-asserted.

### Security

```bash
pnpm audit          # raw pnpm output, everything
pnpm audit:check    # the gate: fails on anything NOT reviewed
pnpm audit:baseline # regenerate the baseline (then write real reasons)
```

**Why a baseline rather than `pnpm audit --audit-level=high`.** Every advisory in
this tree today is transitive, and none is fixable without a major upgrade of
something the kit does not use. The bulk arrives through Stellar Wallets Kit's
bundled WalletConnect, Trezor and Solana support — none of which this project
registers (`wallet.ts` loads browser-extension modules only) and whose builds are
denied in `pnpm-workspace.yaml`. A plain gate would be red on day one, and a gate
that is always red is a gate everyone learns to ignore.

So the rule is **nothing new**. `security/audit-baseline.json` lists each known
advisory with a written reason, in the repo, in review. Anything not on that list
fails the build.

Carried today: **30 advisories** (1 critical, 9 high, 18 moderate, 2 low) across
`protobufjs`, `axios`, `postcss`, `sharp`, `uuid`, `elliptic` and `esbuild`. All
transitive, all with a documented reason. When you add one, write a real reason —
"TODO" is not a reason and will be spotted in review.

The `security` workflow also runs Gitleaks over full history (a key committed and
later "removed" is still leaked), checks that no real `.env` file is tracked, and
greps for secrets prefixed `NEXT_PUBLIC_`, which Next would inline into the
browser bundle.

CodeQL runs `security-extended` on every PR and weekly.

### Build

```bash
pnpm build            # packages, then the hub
pnpm build:packages   # the six libraries via tsup
```

CI additionally asserts every package emits both `dist/index.js` and
`dist/index.d.ts`, and runs the second app (`pnpm sample`) against the built
packages — which is what stops "these are reusable packages" from quietly
becoming false.

## Git hooks

- **pre-commit** — `lint-staged`: ESLint `--fix` and Prettier on staged files only. Fast.
- **pre-push** — `pnpm typecheck && pnpm test`. Slower on purpose: a broken push
  costs everyone, a slow push costs you.

Hooks are installed by `pnpm install` (the `prepare` script). To bypass one in a
genuine emergency, `git commit --no-verify` — and then fix it.

## What CI checks

Every workflow runs on pull requests and pushes to `main` unless noted.

| Workflow | Checks |
| --- | --- |
| `lint` | ESLint, then Prettier `--check` |
| `typecheck` | `tsc --noEmit` for scripts, then every package and app |
| `test` | Vitest plus coverage thresholds; uploads the coverage report |
| `build` | Package builds, ESM + types present, hub build, sample app runs |
| `smoke` | Builds and serves the app with **no configuration**, then exercises every page, the anchor registry, both quote endpoints and the x402 guard over HTTP |
| `security` | Audit gate, Gitleaks over full history, `.env` hygiene, `NEXT_PUBLIC_` secret grep. Also weekly |
| `codeql` | `security-extended` static analysis. Also weekly |
| `mutation` | Stryker. **Weekly and on demand only**, not on PRs |

Each job fails immediately on the first failed step. Dependency installs are
cached by `actions/setup-node` keyed on the lockfile, and `pnpm install
--frozen-lockfile` means a stale cache can never quietly change what is installed.

## Environment variables

**No variable is required to run the checks.** The suite is hermetic and the smoke
workflow deliberately runs with no environment at all. That is a property worth
keeping: a fresh clone works.

For running the app against live anchors locally, copy `.env.example` to
`.env.local` and fill it in. `pnpm diagnose` reports what is actually configured
by calling the anchor rather than guessing from variable names.

**Nothing needs to be added to GitHub Actions secrets.** No workflow reads one.
`GITHUB_TOKEN` is provided automatically. Gitleaks needs a licence key only for
organisation accounts — if this repo moves under an org and the scan starts
failing on licensing, add `GITLEAKS_LICENSE` as a repository secret.

## Reading the common failures

**`Coverage for lines (78%) does not meet global threshold (80%)`**
You added code without tests, or deleted tests. Add tests. Do not lower the
threshold and do not add an exclusion.

**`error TS2353: Object literal may only specify known properties`**
Usually a test built against a type it guessed at. Read the interface in
`packages/ramp-core/src/types.ts` — `CreateOrderRequest` in particular is much
smaller than it looks.

**`@typescript-eslint/no-explicit-any`**
Deliberate, and an error rather than a warning. Anchor payloads are `unknown`
until parsed. If you genuinely need an escape hatch, `unknown` plus a narrowing
check is almost always what you meant.

**Prettier reports files you did not touch**
Run `pnpm format`. If it reformats a vendored template under `.claude/` or
`.agents/`, those should be in `.prettierignore` — check it matches
`eslint.config.mjs`'s ignore list.

**`Cannot find TestRunner plugin "vitest"` from Stryker**
pnpm's symlinked `node_modules` does not expose the plugin to Stryker's sandbox
by glob. It is named explicitly in `stryker.config.json`; do not remove that.

**ESLint or tsc suddenly reports hundreds of errors in `.stryker-tmp`**
A mutation run crashed and left its sandbox behind. `rm -rf .stryker-tmp`. Both
tools ignore that path now, so this should not recur.

**`pnpm audit:check` fails with an unreviewed advisory**
Something new landed. Fix it if a patch exists. If it genuinely cannot be fixed,
add the GHSA id to `security/audit-baseline.json` with a real reason and get that
reviewed — the reason is the point of the file.

**A test passes alone but fails in the suite**
Shared state on `globalThis`: the x402 spent-hash ledger, the mock order store,
or the TOML cache. Give the test its own transaction hash, order id or home
domain rather than sharing one.
