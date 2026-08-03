# Contributing

Thanks for looking. The full guide lives in
**[docs/contributing.md](./docs/contributing.md)** — setup, tests, style,
commits and what CI expects.

## The short version

```bash
corepack enable pnpm
pnpm install
pnpm dev            # http://localhost:3000, no credentials needed
pnpm verify         # lint + typecheck + test + build — what CI runs
```

## Before opening a pull request

- `pnpm verify` passes
- New behaviour has a test
- Conventional Commits: `feat(router): …`, `fix(etherfuse): …`, `docs(anchors): …`
- Anything simulated still reports `mode: 'mock'` and renders its badge

That last one is not a formality. The credibility of every genuinely live part
of this project rests on the simulated parts being honestly labelled.

## Also worth reading

- [docs/architecture.md](./docs/architecture.md) — why the kit is shaped this way
- [docs/anchors.md](./docs/anchors.md) — how to add an anchor
- [docs/gotchas.md](./docs/gotchas.md) — the traps, before you rediscover one
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md) — report vulnerabilities privately, not in an issue
