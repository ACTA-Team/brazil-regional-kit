# Deployment

The hub is a standard Next.js app. Nothing about it is Vercel-specific — it
runs anywhere Next runs — but Vercel is the shortest path.

## Before you deploy

```bash
pnpm verify   # lint + typecheck + test + build
```

CI runs the same gate on every push, plus a job that boots the built app with
**no configuration at all** and checks that every page renders and the
multi-anchor endpoint answers. That second job is the one that matters: it is
the exact state someone cloning the repo lands in.

## Vercel

### 1. Import the repository

[vercel.com/new](https://vercel.com/new) → import the GitHub repo.

### 2. Tell it this is a monorepo

Vercel's autodetection will find the Next app but not the workspace root. Set:

| Setting | Value |
|---|---|
| **Framework Preset** | Next.js |
| **Root Directory** | `apps/hub` |
| **Include files outside the root directory** | **on** — the packages live above it |
| **Install Command** | `cd ../.. && pnpm install --frozen-lockfile` |
| **Build Command** | `cd ../.. && pnpm build:packages && pnpm --filter @brk/hub build` |
| **Output Directory** | leave empty (Next default) |

The install and build commands run from the workspace root because the app
depends on six sibling packages. Without `cd ../..`, pnpm resolves only the
app's own `package.json` and the `workspace:*` dependencies fail.

### 3. Environment variables

**Deploy with none.** With no variables set, the Etherfuse adapter replays
recorded fixtures and the SEP anchor is live regardless. Every page works, the
router returns real quotes from one live anchor, and nothing can break because
a sandbox is down.

That is the recommended configuration for a public demo, and it is what the CI
`fresh-clone` job proves works.

If you want the Etherfuse sandbox live in the deployed app:

| Variable | Value | Scope |
|---|---|---|
| `ETHERFUSE_MODE` | `live` | Production |
| `ETHERFUSE_API_KEY` | your sandbox key | Production (**secret**) |
| `ETHERFUSE_CUSTOMER_ID` | from `pnpm setup:etherfuse` | Production |
| `ETHERFUSE_BANK_ACCOUNT_ID` | from `pnpm setup:etherfuse` | Production |

Optional:

| Variable | Effect |
|---|---|
| `SEP_ANCHOR_HOME_DOMAIN` | Point at a different SEP anchor |
| `SWAP_MODE=dex` | Prefer real order books for the corridor swap |
| `X402_PAY_TO` | Collect x402 payments instead of burning them |
| `NEXT_PUBLIC_DEMO_RECIPIENT_ADDRESS` | Pre-fill the corridor's recipient field |

`ETHERFUSE_API_KEY` is read only in `server-only` modules and never reaches the
browser. Anything that must reach the browser is prefixed `NEXT_PUBLIC_`.

### 4. Deploy

Push to `main`. Vercel builds and gives you a URL.

## Anywhere else

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start          # serves apps/hub on $PORT, default 3000
```

Node 20 or newer. The app has no database and no persistent storage.

### Docker

```dockerfile
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY --from=build /app .
EXPOSE 3000
CMD ["pnpm", "start"]
```

For a smaller image, use Next's standalone output (`output: 'standalone'` in
`next.config.ts`) and copy only `.next/standalone`.

## Checks after deploying

```bash
BASE=https://your-deployment.vercel.app

for path in / /onramp /offramp /router /corridor /x402; do
  echo "$path $(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")"
done

# Anchor status, as the running system reports it
curl -s "$BASE/api/anchors" | jq '.anchors[] | {id, mode}'

# The multi-anchor endpoint
curl -s "$BASE/api/quotes?sell=iso4217:BRL&amount=500&country=BR" | jq '.quotes | length'

# x402 challenges an unpaid request
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/premium-fx"   # → 402
```

Then open the site with Freighter on **testnet** and walk the demo. The wallet
half only works over HTTPS or on localhost, which a Vercel deployment satisfies.

## Publishing the packages

The workspace uses `publishConfig` so development resolves TypeScript source
while a published tarball resolves built output.

```bash
pnpm build:packages
pnpm --filter "./packages/*" publish --access public
```

Rename the `@brk` scope to one you own first.
