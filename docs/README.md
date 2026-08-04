# Documentation

| | |
|---|---|
| [architecture.md](./architecture.md) | Why the kit is shaped this way, and where the seams are |
| [anchors.md](./anchors.md) | Every anchor, what is genuinely real, and how to add one |
| [protocols.md](./protocols.md) | SEP-1/10/24/38 and x402 as implemented here |
| [gotchas.md](./gotchas.md) | The traps that cost real time, and where each is handled |
| [deployment.md](./deployment.md) | Deploying the hub, and publishing the packages |
| [contributing.md](./contributing.md) | Local setup, tests, style, commits |

Package-level docs live next to the code:

- [`packages/kit/core`](../packages/kit/core/README.md) — the adapter contract
- [`packages/kit/router`](../packages/kit/router/README.md) — one API, many anchors
- [`packages/anchors/etherfuse`](../packages/anchors/etherfuse/README.md) — PIX
- [`packages/anchors/sep`](../packages/anchors/sep/README.md) — any SEP anchor
- [`packages/kit/stablecoin`](../packages/kit/stablecoin/README.md) — chain, swaps, x402
