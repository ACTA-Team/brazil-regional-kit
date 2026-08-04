/**
 * Answer one question: is this configured to run for real, and if not, what is
 * missing?
 *
 *   pnpm diagnose
 *
 * Every check reports the actual state of the system rather than the intended
 * one — it calls the anchor, reads the chain, and creates a throwaway order to
 * find out whether KYC is genuinely complete. Guessing from env vars alone is
 * how you end up believing a demo is live while it quietly replays fixtures.
 */

import { randomUUID } from 'node:crypto';
import { Horizon } from '@stellar/stellar-sdk';
import { EtherfuseHttpClient, ETHERFUSE_SANDBOX_URL } from '@brk/adapter-etherfuse';
import { HORIZON_TESTNET, TESOURO_ISSUER_TESTNET, USDC_ISSUER_TESTNET } from '@brk/ramp-core';
import { bold, cyan, dim, green, heading, loadEnv, red, yellow } from './lib/env';

loadEnv();

type Verdict = 'ok' | 'warn' | 'fail';

const mark = (v: Verdict) => (v === 'ok' ? green('✓') : v === 'warn' ? yellow('!') : red('✗'));

const results: Array<{ verdict: Verdict; fix?: string }> = [];

function report(verdict: Verdict, label: string, detail = '', fix?: string) {
  console.log(`  ${mark(verdict)} ${label.padEnd(34)} ${detail}`);
  results.push({ verdict, fix });
}

async function main() {
  heading('Brazil Regional Kit — configuration check');

  // ── Credentials ────────────────────────────────────────────────────────────
  const apiKey = process.env.ETHERFUSE_API_KEY;
  const customerId = process.env.ETHERFUSE_CUSTOMER_ID;
  const bankAccountId = process.env.ETHERFUSE_BANK_ACCOUNT_ID;
  const wallet = process.env.NEXT_PUBLIC_DEMO_RECIPIENT_ADDRESS;

  console.log(`\n${bold('Credentials')}`);

  report(
    apiKey ? 'ok' : 'warn',
    'ETHERFUSE_API_KEY',
    apiKey ? dim(`${apiKey.slice(0, 14)}…`) : dim('absent — Etherfuse will replay fixtures'),
    apiKey ? undefined : 'Get a sandbox key at https://devnet.etherfuse.com/ramp',
  );

  report(
    customerId ? 'ok' : apiKey ? 'fail' : 'warn',
    'ETHERFUSE_CUSTOMER_ID',
    customerId ? dim(customerId) : dim('absent'),
    customerId ? undefined : 'Run: pnpm setup:etherfuse',
  );

  report(
    bankAccountId ? 'ok' : apiKey ? 'fail' : 'warn',
    'ETHERFUSE_BANK_ACCOUNT_ID',
    bankAccountId ? dim(bankAccountId) : dim('absent'),
    bankAccountId ? undefined : 'Run: pnpm setup:etherfuse',
  );

  // ── Effective mode ─────────────────────────────────────────────────────────
  console.log(`\n${bold('Mode')}`);

  const wantsLive =
    (process.env.ETHERFUSE_MODE ?? process.env.RAMP_MODE ?? 'mock').toLowerCase() === 'live';
  const canBeLive = Boolean(apiKey);

  report(
    wantsLive && canBeLive ? 'ok' : 'warn',
    'Etherfuse effective mode',
    wantsLive && canBeLive
      ? green('live')
      : wantsLive
        ? yellow('mock — asked for live but there is no API key')
        : yellow('mock'),
    wantsLive && canBeLive ? undefined : 'Set ETHERFUSE_MODE=live in .env.local',
  );

  report('ok', 'SEP anchor', green('live') + dim(' — SEP-38 prices need no credentials'));

  // ── Does the anchor actually answer? ───────────────────────────────────────
  if (apiKey && customerId && bankAccountId) {
    console.log(`\n${bold('Live sandbox')}`);

    const client = new EtherfuseHttpClient({
      apiKey,
      baseUrl: process.env.ETHERFUSE_BASE_URL ?? ETHERFUSE_SANDBOX_URL,
    });
    const probeWallet = wallet ?? 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4';

    /*
     * Etherfuse rejects a second pending order for the same bank account AND
     * amount, so probing with a round number like 500 collides with whatever
     * the user is doing in the UI and leaves an un-cancellable order sitting in
     * their way — there is no cancel endpoint. An odd, sub-minimum-ish amount
     * nobody would type by hand keeps this check out of the way.
     */
    const probeAmount = `${11 + Math.floor(Math.random() * 9)}.${String(
      Math.floor(Math.random() * 90) + 10,
    )}`;

    let quoteId: string | undefined;
    try {
      const quote = await client.quote({
        quoteId: randomUUID(),
        customerId,
        blockchain: 'stellar',
        walletAddress: probeWallet,
        quoteAssets: {
          type: 'onramp',
          sourceAsset: 'BRL',
          targetAsset: `TESOURO:${TESOURO_ISSUER_TESTNET}`,
        },
        sourceAmount: probeAmount,
      });
      quoteId = quote.quoteId;
      report(
        'ok',
        'Quotes',
        dim(`${probeAmount} BRL → ${Number(quote.destinationAmount).toFixed(2)} TESOURO`),
      );
    } catch (e) {
      report('fail', 'Quotes', red((e as Error).message.slice(0, 60)));
    }

    /*
     * The real test of whether onboarding finished. Until the customer completes
     * KYC the anchor answers `Proxy account not found`, and no amount of correct
     * configuration changes that — so this is the one check that cannot be
     * inferred from env vars.
     */
    if (quoteId) {
      try {
        await client.createOrder({
          orderId: randomUUID(),
          bankAccountId,
          publicKey: probeWallet,
          quoteId,
        });
        report('ok', 'KYC / orders', green('complete — real orders work'));
      } catch (e) {
        const message = (e as Error).message;
        const pending = /proxy account not found/i.test(message);
        // "An order already exists" is the anchor confirming orders work — it
        // got far enough to check for duplicates, which needs a real customer.
        const alreadyOrdered = /already exists/i.test(message);

        if (alreadyOrdered) {
          report('ok', 'KYC / orders', green('complete — real orders work'));
        } else {
          report(
            pending ? 'fail' : 'warn',
            'KYC / orders',
            pending ? red('not finished') : dim(message.slice(0, 60)),
            pending
              ? 'Open the URL from `pnpm setup:etherfuse` and complete the KYC form'
              : undefined,
          );
        }
      }
    }
  }

  // ── Chain ──────────────────────────────────────────────────────────────────
  console.log(`\n${bold('Chain')}`);

  const horizon = new Horizon.Server(HORIZON_TESTNET);

  if (wallet) {
    try {
      const account = await horizon.loadAccount(wallet);
      const held = (code: string) =>
        account.balances.find((b) => 'asset_code' in b && b.asset_code === code)?.balance;

      report('ok', 'Demo wallet funded', dim(`${wallet.slice(0, 8)}…`));

      for (const [code, issuer] of [
        ['TESOURO', TESOURO_ISSUER_TESTNET],
        ['USDC', USDC_ISSUER_TESTNET],
      ] as const) {
        const balance = account.balances.find(
          (b) => 'asset_code' in b && b.asset_code === code && b.asset_issuer === issuer,
        );
        report(
          balance ? 'ok' : 'warn',
          `${code} trustline`,
          balance ? dim(`balance ${balance.balance}`) : dim('missing'),
          balance ? undefined : `Connect the wallet in the hub and sign the ${code} trustline`,
        );
      }

      void held;
    } catch {
      report(
        'warn',
        'Demo wallet',
        dim('not funded on testnet'),
        `curl "https://friendbot.stellar.org?addr=${wallet}"`,
      );
    }
  } else {
    report(
      'warn',
      'Demo wallet',
      dim('NEXT_PUBLIC_DEMO_RECIPIENT_ADDRESS not set'),
      'Set it to your wallet address to have this checked',
    );
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  const failures = results.filter((r) => r.verdict === 'fail');
  const warnings = results.filter((r) => r.verdict === 'warn');
  const fixes = [...failures, ...warnings].map((r) => r.fix).filter(Boolean);

  console.log('');
  if (failures.length === 0 && warnings.length === 0) {
    console.log(`  ${green(bold('Everything is live. Nothing is simulated.'))}\n`);
  } else if (failures.length === 0) {
    console.log(`  ${yellow(bold('Runnable, with some parts simulated.'))}\n`);
  } else {
    console.log(`  ${red(bold('Not fully live yet.'))}\n`);
  }

  if (fixes.length) {
    console.log(`  ${bold('To fix:')}`);
    for (const fix of [...new Set(fixes)]) console.log(`    ${cyan('→')} ${fix}`);
    console.log('');
  }

  console.log(dim('  Env changes need a dev-server restart — Next reads them once at boot.\n'));
}

main().catch((e) => {
  console.error(`\n${red((e as Error).message)}\n`);
  process.exit(1);
});
