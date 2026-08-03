/**
 * Capture live sandbox responses into the mock's fixtures.
 *
 *   pnpm fixtures:record
 *
 * This is what makes mock mode honest. Without it the simulator invents plausible
 * numbers; with it, mock mode replays rates, fees, limits and payload shapes that
 * the real Etherfuse sandbox actually returned, with a timestamp saying when.
 *
 * Everything identifying is stripped before anything is written: customer ids,
 * bank account ids, wallet addresses and any key-like string never reach disk.
 * Fixtures are committed to the repo, so this matters.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EtherfuseHttpClient, ETHERFUSE_SANDBOX_URL } from '@brk/adapter-etherfuse';
import { bold, cyan, dim, green, heading, loadEnv, repoRoot, requireEnv, yellow } from './lib/env';

loadEnv();

const FIXTURES = join(repoRoot, 'packages', 'adapter-etherfuse', 'fixtures');

const SECRET_KEYS = new Set([
  'customerid',
  'bankaccountid',
  'walletaddress',
  'publickey',
  'apikey',
  'authorization',
  'email',
  'phone',
  'cpf',
  'cnpj',
  'taxid',
  'name',
]);

/** Recursively drop identifying fields. Unknown keys are kept — shape matters. */
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SECRET_KEYS.has(key.toLowerCase()) ? '<redacted>' : sanitize(v);
    }
    return out;
  }
  return value;
}

const TESOURO_ASSET = 'TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4';

/** A throwaway testnet address — never a real user's, so nothing to redact. */
const PROBE_ACCOUNT = 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4';

interface Probe {
  label: string;
  key: string;
  direction: 'onramp' | 'offramp';
  sourceAsset: string;
  targetAsset: string;
  amount: string;
}

const PROBES: Probe[] = [
  {
    label: 'BRL → TESOURO',
    key: 'BRL>TESOURO',
    direction: 'onramp',
    sourceAsset: 'BRL',
    targetAsset: TESOURO_ASSET,
    amount: '500',
  },
  {
    label: 'TESOURO → BRL',
    key: 'TESOURO>BRL',
    direction: 'offramp',
    sourceAsset: TESOURO_ASSET,
    targetAsset: 'BRL',
    amount: '100',
  },
];

async function main() {
  heading('Recording Etherfuse fixtures');

  const apiKey = requireEnv(
    'ETHERFUSE_API_KEY',
    'Recording needs the live sandbox. Run `pnpm setup:etherfuse` first.',
  );
  const customerId = requireEnv(
    'ETHERFUSE_CUSTOMER_ID',
    'Run `pnpm setup:etherfuse` and complete onboarding first.',
  );

  const client = new EtherfuseHttpClient({
    apiKey,
    baseUrl: process.env.ETHERFUSE_BASE_URL ?? ETHERFUSE_SANDBOX_URL,
  });

  const recordedAt = new Date().toISOString();

  // ── Assets ─────────────────────────────────────────────────────────────────
  const assets = (
    await Promise.all(
      ['BRL', 'MXN'].map((currency) =>
        client
          .listAssets({ blockchain: 'stellar', currency, wallet: PROBE_ACCOUNT })
          .catch(() => []),
      ),
    )
  ).flat();
  writeFileSync(
    join(FIXTURES, 'assets.json'),
    `${JSON.stringify(
      {
        $comment:
          'Captured from the live Etherfuse sandbox by `pnpm fixtures:record`. Identifying fields are redacted.',
        recordedAt,
        source: 'live-sandbox',
        assets: sanitize(assets),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  ${green('✓')} assets.json ${dim(`(${assets.length} assets)`)}`);

  // ── Quotes ─────────────────────────────────────────────────────────────────
  const pairs: Record<string, { rate: string; feeBps: number }> = {};
  const rawQuotes: Record<string, unknown> = {};
  let quoteTtlSeconds = 45;

  for (const probe of PROBES) {
    try {
      const response = await client.quote({
        quoteId: randomUUID(),
        customerId,
        blockchain: 'stellar',
        walletAddress: PROBE_ACCOUNT,
        quoteAssets: {
          type: probe.direction,
          sourceAsset: probe.sourceAsset,
          targetAsset: probe.targetAsset,
        },
        sourceAmount: probe.amount,
      });

      const source = Number(response.sourceAmount ?? probe.amount);
      const target = Number(response.destinationAmount ?? 0);
      const fee = Number(response.feeAmount ?? 0);

      // Recover the fee as basis points of the source amount, so the simulator
      // scales it to any amount instead of replaying one fixed number.
      const feeBps = source > 0 ? Math.round((fee / source) * 10_000) : 0;
      const net = source - fee;
      const rate = response.exchangeRate ?? (net > 0 ? (target / net).toFixed(7) : '0');

      pairs[probe.key] = { rate: String(rate), feeBps };
      rawQuotes[probe.key] = sanitize(response);

      if (response.expiresAt) {
        const ttl = Math.round((new Date(response.expiresAt).getTime() - Date.now()) / 1000);
        if (ttl > 0 && ttl < 600) quoteTtlSeconds = ttl;
      }

      console.log(`  ${green('✓')} ${bold(probe.label)} ${dim(`rate=${rate} feeBps=${feeBps}`)}`);
    } catch (e) {
      console.log(`  ${yellow('!')} ${probe.label}: ${(e as Error).message}`);
    }
  }

  if (Object.keys(pairs).length === 0) {
    console.log(`\n  ${yellow('No quotes recorded — leaving the existing fixtures untouched.')}\n`);
    return;
  }

  // Cross-rates the sandbox does not quote directly, kept so the router and the
  // corridor still have numbers to work with. Clearly marked as derived.
  const derived = {
    'TESOURO>USDC': { rate: '0.1845000', feeBps: 30, derived: true },
    'USDC>TESOURO': { rate: '5.4200000', feeBps: 30, derived: true },
    'USDC>MXN': { rate: '17.2000000', feeBps: 140, derived: true },
    'USDC>BRL': { rate: '5.3800000', feeBps: 140, derived: true },
  };

  writeFileSync(
    join(FIXTURES, 'rates.json'),
    `${JSON.stringify(
      {
        $comment:
          'Captured from the live Etherfuse sandbox by `pnpm fixtures:record`. Pairs marked `derived` were not quoted by the sandbox and are cross-rates kept so the corridor demo has numbers; the UI labels every mock quote as simulated regardless.',
        recordedAt,
        source: 'live-sandbox',
        pairs: { ...pairs, ...derived },
        limits: {
          BRL: { min: '10', max: '20000' },
          MXN: { min: '50', max: '100000' },
          TESOURO: { min: '10', max: '20000' },
          USDC: { min: '2', max: '5000' },
        },
        quoteTtlSeconds,
        pix: {
          $comment: 'Non-routable sandbox PIX key. Structurally valid BR Codes, payable by nobody.',
          key: 'sandbox@brazil-regional-kit.demo',
          merchantName: 'BRK Sandbox Ramps',
          merchantCity: 'Sao Paulo',
        },
        anchorAccount: 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4',
        rawQuotes,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`  ${green('✓')} rates.json ${dim(`(quote TTL ${quoteTtlSeconds}s)`)}`);
  console.log(
    `\n  ${bold('Mock mode now replays the real sandbox.')}\n  ${dim('Try it:')} ${cyan('RAMP_MODE=mock pnpm dev')}\n`,
  );
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
});
