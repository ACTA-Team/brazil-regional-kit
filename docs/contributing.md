# Contributing

## Setup

```bash
corepack enable pnpm      # or: npm install -g pnpm
pnpm install
pnpm dev
```

Node 20 or newer. No credentials needed — everything runs against recorded
fixtures plus real Stellar testnet.

## Commands

| | |
|---|---|
| `pnpm dev` | Hub at http://localhost:3000 |
| `pnpm sample` | The CLI app that imports the packages |
| `pnpm test` | Unit tests |
| `pnpm test:watch` | Tests in watch mode |
| `pnpm test:coverage` | Coverage report |
| `pnpm lint` | ESLint + Prettier check |
| `pnpm lint:fix` | Fix what can be fixed |
| `pnpm typecheck` | Every package and app |
| `pnpm build` | Packages, then the hub |
| `pnpm verify` | All of the above — what CI runs |

## Layout

```
packages/   the deliverable — six publishable libraries
apps/       proof they work — the hub, and a second app that only imports them
scripts/    operator tools (Etherfuse setup, fixture recording, DEX seeding)
docs/       this
```

Workspace packages are consumed as **TypeScript source** in development via
`transpilePackages`, so editing `ramp-core` hot-reloads the hub with no build
step in between. `tsup` builds are only for publishing.

## Tests

Vitest, colocated as `*.test.ts` next to what they test.

**The suite is hermetic.** Nothing reaches Horizon or an anchor: CI has no
credentials and a test that fails because a third party is down is worse than
no test. Where network behaviour matters, inject a fake `fetch` or point at an
unreachable host and assert the failure direction.

Test the behaviour that would actually cost someone money:

```ts
// Good — pins a real hazard, in the language where it bites
it('flags a memo that fits in characters but not in bytes', () => {
  expect(checkMemo('Para meus avós em Guadalajara')).toMatchObject({ valid: false, bytes: 30 });
});

// Less useful — restates the implementation
it('returns an object', () => {
  expect(typeof checkMemo('x')).toBe('object');
});
```

## Style

Prettier and ESLint decide formatting; do not argue with them in review.

Two conventions that are not enforced by tooling and matter here:

**Comments explain why, never what.** The code says what it does. A comment
earns its place by recording the reason a line exists — a trap in an anchor's
API, a decision that looks wrong until you know the constraint.

```ts
// Good
// NOT `Bearer ${key}` — Etherfuse takes the raw key. This is the single most
// common integration mistake against their API.

// Noise
// Set the authorization header
```

**Be honest in the UI.** Anything simulated must say so, all the way to the
badge a user sees. The whole credibility of the live parts rests on the
simulated parts being labelled.

## Adding an anchor

See [anchors.md](./anchors.md). Short version: implement `RampAdapter`,
translate assets at the edge, throw `RampError` with a real code, and be honest
about `mode`.

## Commits

Conventional Commits, one logical change each:

```
feat(router): rank quotes within a destination asset
fix(etherfuse): reject C… contract addresses with an explanation
test(ramp-core): cover accented memos at the byte boundary
docs(anchors): explain why Manteca and Koywe are simulated
chore(ci): run the sample app so the reuse claim cannot rot
```

Scopes are package or app names: `ramp-core`, `router`, `etherfuse`, `sep`,
`mocks`, `stablecoin-kit`, `hub`, `sample`, `scripts`, `ci`, `docs`.

Hooks run automatically:

- **pre-commit** — `lint-staged` formats and lints what you staged
- **pre-push** — `typecheck` and `test`, because a broken push costs everyone

## Pull requests

CI must be green. It runs `lint`, `typecheck`, `test`, `build`, the sample app,
and a zero-configuration boot that checks every page renders and the
multi-anchor endpoint answers.

If a change touches an anchor's real behaviour, say in the PR whether you
verified it against the live sandbox or only against fixtures.
