/**
 * One-time Etherfuse onboarding.
 *
 *   pnpm setup:etherfuse
 *
 * Creates the customer identity the adapter reuses forever and prints the KYC
 * URL to open. Run it ONCE per environment: Etherfuse ties orders to the
 * `customerId`/`bankAccountId` pair, so regenerating them mid-project orphans
 * every order created before. The script refuses to run a second time unless
 * you pass --force, precisely to stop that happening by accident.
 *
 * It also dumps `GET /ramp/assets`, which is the authoritative answer to
 * "does the sandbox actually serve MXN/CETES?" — worth knowing before building
 * a Mexican leg on the assumption that it does.
 */

import { randomUUID } from 'node:crypto';
import { EtherfuseHttpClient, ETHERFUSE_SANDBOX_URL } from '@brk/adapter-etherfuse';
import { bold, cyan, dim, green, heading, loadEnv, requireEnv, yellow } from './lib/env';

loadEnv();

const force = process.argv.includes('--force');

async function main() {
  heading('Etherfuse sandbox setup');

  const apiKey = requireEnv(
    'ETHERFUSE_API_KEY',
    'Get a sandbox key at https://devnet.etherfuse.com/ramp, then put it in .env.local',
  );

  const baseUrl = process.env.ETHERFUSE_BASE_URL ?? ETHERFUSE_SANDBOX_URL;
  const existingCustomer = process.env.ETHERFUSE_CUSTOMER_ID;

  if (existingCustomer && !force) {
    console.log(
      `\n${yellow('Already set up.')} ETHERFUSE_CUSTOMER_ID=${existingCustomer}\n\n` +
        `  Reuse it — Etherfuse ties existing orders to this id.\n` +
        `  ${dim('Pass --force only if you truly want a new customer identity.')}\n`,
    );
  }

  const client = new EtherfuseHttpClient({ apiKey, baseUrl });
  const customerId = force || !existingCustomer ? randomUUID() : existingCustomer;

  // ── Asset catalogue ────────────────────────────────────────────────────────
  heading('GET /ramp/assets');
  try {
    const assets = await client.listAssets();
    if (assets.length === 0) {
      console.log(dim('  (empty — the sandbox returned no assets)'));
    }
    for (const asset of assets) {
      const code = asset.code ?? asset.symbol ?? '?';
      const currency = asset.currency ? ` ${dim('←')} ${asset.currency}` : '';
      const chain = asset.blockchain ? dim(` [${asset.blockchain}]`) : '';
      console.log(`  ${green('•')} ${bold(code)}${currency}${chain}`);
      if (asset.issuer) console.log(`    ${dim(String(asset.issuer))}`);
    }
    console.log(`\n${dim('  Raw catalogue:')}\n${JSON.stringify(assets, null, 2)}`);
  } catch (e) {
    console.log(`  ${yellow('Could not list assets:')} ${(e as Error).message}`);
  }

  if (existingCustomer && !force) return;

  // ── Onboarding ─────────────────────────────────────────────────────────────
  heading('POST /ramp/onboarding-url');
  const onboarding = await client.createOnboardingUrl({ customerId });

  console.log(`\n  ${bold('1.')} Open this URL and complete the sandbox KYC:\n`);
  console.log(`     ${cyan(onboarding.url)}\n`);
  console.log(`  ${bold('2.')} Then add these to ${bold('.env.local')} and never change them:\n`);
  console.log(`     ETHERFUSE_CUSTOMER_ID=${onboarding.customerId ?? customerId}`);
  console.log(
    `     ETHERFUSE_BANK_ACCOUNT_ID=${onboarding.bankAccountId ?? '<from the KYC flow>'}`,
  );
  console.log(`\n  ${bold('3.')} Flip the adapter to live:\n`);
  console.log(`     ETHERFUSE_MODE=live\n`);
  console.log(
    `  ${bold('4.')} Capture real fixtures so mock mode mirrors the sandbox:\n\n     ${dim('pnpm fixtures:record')}\n`,
  );

  if (onboarding.bankAccountId === undefined) {
    console.log(
      dim(
        '  Note: the sandbox did not return a bankAccountId here. It normally appears\n' +
          '  at the end of the KYC flow — copy it from there.\n',
      ),
    );
  }
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
});
