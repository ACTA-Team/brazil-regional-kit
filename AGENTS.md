# Working in this repository

Rules for anyone changing this code, human or AI. They are not style preferences —
each one exists because ignoring it has a specific, known cost in a codebase that
moves other people's money.

`CLAUDE.md` is a symlink-free copy of this file; keep the two in step if you edit
either.

## What this project is

A pnpm workspace of six TypeScript packages plus a Next.js demo hub. The packages
are the product — other people import them. `apps/hub` demonstrates them.

The domain is fiat↔crypto ramps on Stellar: PIX on/off-ramps, a multi-anchor
quote router, SEP-10/24/38 protocol clients, DEX swaps and x402 payments. Amounts
are decimal strings end to end, never floats.

## Before you change anything

1. **Read the surrounding files first.** Especially the header comment of any
   module you are touching. They record traps discovered against live anchors —
   the raw Authorization header, the singular `/ramp/order` path, the 28-byte
   memo limit. Most of them are not recoverable by reasoning about the code.
2. **Run the suite before you start**, so you can tell your failures from
   pre-existing ones: `pnpm test`.
3. **Check whether a test already covers what you are about to change.** If one
   does and your change breaks it, the test is probably right.

## Tests

- **Never delete, skip or weaken a test to make a pipeline pass.** No `.skip`,
  no `.only`, no loosened assertion, no deleted case. If a test is genuinely
  wrong, say so explicitly in your report and explain why.
- **Every bug fix needs a regression test that fails before the fix.** Write the
  failing test first, watch it fail, then fix the cause. A fix without a failing
  test first is a guess.
- **Every new feature needs tests**: the happy path, the edge cases, the invalid
  inputs and the expected errors.
- **Fix causes, not symptoms.** If a test fails, understand why before changing
  anything.
- Mock only genuinely external things — an anchor's HTTP API, Horizon, a wallet
  extension. Never mock the thing you are testing. Most clients here take an
  injected `fetch`; use it instead of reaching for a module mock.
- The suite is **hermetic**: no network, no credentials, no anchor, no Horizon.
  It must pass on a fresh clone with no `.env`. Keep it that way.
- **No order-dependent tests.** Several modules keep state on `globalThis` (the
  x402 spent-hash ledger, the mock order store, the TOML cache). Give each test
  its own id or domain rather than sharing one.

## Coverage

- Thresholds live in `vitest.config.ts`: 80% statements, 80% functions, 80%
  lines, 75% branches. **Never lower one to make a build green.**
- **Never add a coverage exclusion to reach a number.** If code is genuinely
  untestable, say so in your report and leave it uncovered.
- Coverage measures `packages/*/src`. `apps/hub` is exercised over real HTTP by
  the `smoke` workflow instead — see `QUALITY.md`.

## Don't hide problems

- **No `any`.** ESLint fails on it. Anchor payloads are `unknown` until parsed.
- **No `@ts-ignore`, `@ts-expect-error` or `eslint-disable`** without a comment
  on the same change explaining the technical reason. "It was failing" is not one.
- Don't widen a type, loosen a threshold or add an ignore pattern to get past a
  check. Fix what the check found.
- If you cannot fix something, leave it failing and report it. A red build that
  tells the truth beats a green one that does not.

## Money, keys and secrets

- **Never touch `.env`, `.env.local` or any credential.** `.env.example` is
  documentation and may be updated; real values are never committed.
- **Never prefix a secret with `NEXT_PUBLIC_`.** Next inlines those into the
  browser bundle. The Etherfuse API key is server-side only and reaches the
  anchor through the hub's API routes.
- Amounts are decimal **strings**. Use the helpers in `ramp-core/money.ts`.
  Never `Number()` an amount to do arithmetic on it — `0.1 + 0.2` is how you end
  up a centavo short on stage.
- Memos are capped at **28 bytes, not 28 characters**. Use `validateMemo`, which
  throws; never truncate user text silently.
- A simulated or fallback price must always be labelled as such. The kit never
  presents a computed number as if the order books had filled it.
- **Never run a destructive migration** or anything that touches real funds.

## Public interfaces

- The packages are imported by other people. Changing an exported signature,
  renaming a field or altering an error `code` is a **breaking change** — call it
  out explicitly in your report rather than slipping it in.
- Don't change a main dependency without explaining why.

## Before you say you are done

Run these, in this order, and actually run them:

```bash
pnpm format:check   # or `pnpm format` to fix
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm audit:check
```

`pnpm verify` runs the whole chain.

## Reporting

Say plainly:

- What you changed and why.
- What you tested, and **the actual command output** — not a summary of it.
- **Never claim a test passed if you did not run it.** Distinguish clearly
  between: commands you ran and their real result; commands unavailable in your
  environment; and checks still outstanding.
- Which problems were already there before you started, separated from any you
  introduced.
- What risks remain, and any breaking change you made.

If something you were asked to do would break production, stop and explain the
risk instead of doing it.
