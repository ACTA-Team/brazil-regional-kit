# Security policy

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/ACTA-Team/brazil-regional-kit/security/advisories/new). Please do not open
a public issue.

Include what you can: the affected package, how to reproduce it, and what an
attacker gets out of it. A proof of concept helps but is not required to file.

You can expect an acknowledgement within a few days, and an assessment with a
fix or an explanation of why it is not one within two weeks.

## Scope

This repository is a **testnet** development kit. It moves no real money and
holds no custody. That lowers the stakes considerably — but the code is meant
to be reused against mainnet, so a flaw here can travel.

In scope, and taken seriously:

- **Signing paths.** Anything that could get a wallet to sign a transaction it
  should not — most importantly the SEP-10 challenge verification. A challenge
  is a transaction an anchor asks you to sign; skipping or weakening the checks
  that it is unsubmittable and genuinely from that anchor is a real hazard.
- **x402 payment verification.** Replay of a spent payment, reuse of a payment
  across resources, accepting an underpayment or the wrong asset, or bypassing
  the age window.
- **Credential leakage.** Anchor API keys reaching the browser, being written
  into fixtures, or appearing in an API response.
- **Customer data in error paths.** `RampError.toJSON()` deliberately drops the
  raw anchor payload; a path that leaks it is a bug.
- **Dependency and supply chain issues** in what this repo ships.

Out of scope:

- Vulnerabilities in Stellar itself, in Horizon, or in a third-party anchor's
  service — report those to the relevant project.
- The testnet secret printed by `pnpm seed:liquidity`. It is disposable by
  construction and funded by friendbot.
- Rates in the Etherfuse fixture replays being stale. They are labelled
  simulated everywhere they appear; that is a documentation matter, not a
  vulnerability.

## Handling secrets in this repository

- The Etherfuse API key is read only in modules marked `server-only` and never
  reaches the client bundle.
- `pnpm fixtures:record` strips customer ids, bank account ids, wallet
  addresses and anything key-shaped before writing. Fixtures are committed, so
  this matters — check the diff.
- `.env`, `.env.local` and `.env.*.local` are gitignored. `.env.example`
  contains names and comments only.
- Never put a mainnet secret in `MARKET_MAKER_SECRET`. The seeding script is
  testnet-only and says so.

If you find a credential committed to this repository, treat it as a
vulnerability and report it privately rather than opening an issue.
