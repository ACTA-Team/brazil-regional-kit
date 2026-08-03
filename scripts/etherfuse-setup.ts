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
  // blockchain, currency and wallet are all mandatory — omitting any is a 400.
  const probeWallet =
    process.env.NEXT_PUBLIC_DEMO_RECIPIENT_ADDRESS ??
    'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4';

  for (const currency of ['BRL', 'MXN']) {
    heading(`GET /ramp/assets — ${currency}`);
    try {
      const assets = await client.listAssets({
        blockchain: 'stellar',
        currency,
        wallet: probeWallet,
      });

      if (assets.length === 0) console.log(dim('  (the sandbox returned no assets)'));

      for (const asset of assets) {
        const symbol = asset.symbol ?? '?';
        const tied = asset.currency ? ` ${dim('←')} ${asset.currency}` : dim(' (no currency)');
        console.log(`  ${green('•')} ${bold(symbol)}${tied}`);
        if (asset.identifier) console.log(`    ${dim(asset.identifier)}`);
      }
    } catch (e) {
      console.log(`  ${yellow('Could not list assets:')} ${(e as Error).message}`);
    }
  }

  if (existingCustomer && !force) return;

  // ── Onboarding ─────────────────────────────────────────────────────────────
  //
  // Both ids are generated HERE and sent to Etherfuse; the API does not mint
  // them for you and does not hand them back. That is why this script prints
  // them and refuses to run twice — lose them and every order made against
  // them is orphaned.
  const bankAccountId = process.env.ETHERFUSE_BANK_ACCOUNT_ID || randomUUID();

  heading('POST /ramp/onboarding-url');

  let onboarding;
  try {
    onboarding = await client.createOnboardingUrl({
      customerId,
      bankAccountId,
      publicKey: probeWallet,
      blockchain: 'stellar',
      userInfo: {
        email: process.env.ETHERFUSE_USER_EMAIL ?? 'sandbox@brazil-regional-kit.demo',
        displayName: process.env.ETHERFUSE_USER_NAME ?? 'BRK Sandbox',
      },
    });
  } catch (e) {
    /*
     * A 409 means this wallet was already onboarded — most often because the
     * KYC was completed through Etherfuse's own portal rather than through a
     * link this script produced. The customer id we would otherwise have no way
     * of knowing is right there in the message: "…see org: <uuid>".
     *
     * Recovering it here saves the alternative, which is onboarding a second
     * customer against the same wallet and wondering why orders still fail.
     */
    const message = (e as Error).message;
    const existing = /see org:\s*([0-9a-f-]{36})/i.exec(message)?.[1];

    if (!existing) throw e;

    console.log(`\n  ${green('This wallet is already onboarded.')}\n`);
    console.log(`  ${bold('Use these — they are the ids Etherfuse has on file:')}\n`);
    console.log(`     ETHERFUSE_CUSTOMER_ID=${existing}`);
    console.log(`     ETHERFUSE_BANK_ACCOUNT_ID=${bankAccountId}\n`);
    console.log(
      dim(
        '  The bank account id above is only a guess if you did the KYC elsewhere.\n' +
          '  Run `pnpm diagnose` — if orders work, it was right.\n',
      ),
    );
    return;
  }

  // Snake case here, camel case everywhere else in the API.
  const url = onboarding.presigned_url ?? onboarding.url;

  console.log(`\n  ${bold('1.')} Save these to ${bold('.env.local')} and never change them:\n`);
  console.log(`     ETHERFUSE_CUSTOMER_ID=${customerId}`);
  console.log(`     ETHERFUSE_BANK_ACCOUNT_ID=${bankAccountId}\n`);
  console.log(`  ${bold('2.')} Open this URL and complete the sandbox KYC:\n`);
  console.log(`     ${cyan(url ?? '(the sandbox returned no URL)')}\n`);
  console.log(
    dim(
      '     The link is signed and expires in about 15 minutes. Re-run this\n' +
        '     script with --force only if you are prepared to lose the ids above.\n',
    ),
  );
  console.log(`  ${bold('3.')} Flip the adapter to live:\n`);
  console.log(`     ETHERFUSE_MODE=live\n`);
  console.log(
    `  ${bold('4.')} Capture real fixtures so mock mode mirrors the sandbox:\n\n     ${dim('pnpm fixtures:record')}\n`,
  );
  console.log(
    `  ${yellow('Orders stay rejected until the KYC in step 2 is finished')} ${dim('("Proxy account not found").')}\n`,
  );
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
});
