# What and why

<!-- What changes, and the reason it needed to. Link an issue if there is one. -->

Closes #

## Type

- [ ] Feature
- [ ] Fix
- [ ] Docs
- [ ] Refactor — no behaviour change
- [ ] Chore / CI / dependencies

## How it was verified

<!-- Delete what does not apply. -->

- [ ] `pnpm verify` passes locally
- [ ] New or updated tests cover the change
- [ ] Checked in the browser with Freighter on **testnet**
- [ ] `pnpm sample` still runs

## Anchor behaviour

<!-- Only if this touches an adapter. This is the question a reviewer cannot
     answer for you, and the one that decides how much to trust the change. -->

- [ ] Not applicable
- [ ] Verified against the anchor's **live sandbox**
- [ ] Verified against **recorded fixtures** only

If fixtures were regenerated, say which anchor and when:

## Honesty check

<!-- The credibility of everything real in this repo rests on the simulated
     parts being labelled. Do not let a mock quietly report itself as live. -->

- [ ] Anything simulated still reports `mode: 'mock'` and renders its badge
- [ ] No credentials, keys or customer data in the diff, fixtures or tests
- [ ] `.env.example` updated if a new variable was introduced

## Notes for the reviewer

<!-- Anything that looks wrong until you know the constraint. Trade-offs taken,
     things deliberately left out, follow-ups worth opening. -->
