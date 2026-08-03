/**
 * Put demo assets in a wallet so the whole flow can be walked without an
 * Etherfuse key.
 *
 *   pnpm demo:fund G...YOUR_ADDRESS
 *
 * The on-ramp in mock mode replays an anchor conversation; it cannot mint real
 * TESOURO, because only Etherfuse can. That leaves a gap: the corridor's DEX
 * swap and the off-ramp both need the asset to actually be in the wallet.
 *
 * This closes it honestly — no minting, no pretending. A disposable testnet
 * account buys TESOURO on the open order books and sends it over. The asset is
 * genuinely Etherfuse's, the trade is genuinely on-chain, and every downstream
 * step behaves exactly as it will with a real on-ramp.
 *
 * Testnet only.
 */

import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  FRIENDBOT,
  HORIZON_TESTNET,
  TESOURO_ISSUER_TESTNET,
  USDC_ISSUER_TESTNET,
} from '@brk/ramp-core';
import { bold, cyan, dim, green, heading, loadEnv, red, yellow } from './lib/env';

loadEnv();

const horizon = new Horizon.Server(HORIZON_TESTNET);
const NETWORK = Networks.TESTNET;

const TESOURO = new Asset('TESOURO', TESOURO_ISSUER_TESTNET);
const USDC = new Asset('USDC', USDC_ISSUER_TESTNET);

/** How much XLM to spend acquiring each asset. Friendbot hands out 10,000. */
const XLM_BUDGET = '600';

async function submit(keypair: Keypair, build: (b: TransactionBuilder) => TransactionBuilder) {
  const account = await horizon.loadAccount(keypair.publicKey());
  const tx = build(new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK }))
    .setTimeout(120)
    .build();
  tx.sign(keypair);
  return horizon.submitTransaction(tx);
}

/** Horizon reports a path as plain records; the operation needs `Asset`s. */
function toAssets(
  path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>,
): Asset[] {
  return path.map((hop) =>
    hop.asset_type === 'native'
      ? Asset.native()
      : new Asset(hop.asset_code as string, hop.asset_issuer as string),
  );
}

function balanceOf(
  account: Awaited<ReturnType<typeof horizon.loadAccount>>,
  asset: Asset,
): string | null {
  const found = account.balances.find((b) =>
    asset.isNative()
      ? b.asset_type === 'native'
      : 'asset_code' in b &&
        b.asset_code === asset.getCode() &&
        b.asset_issuer === asset.getIssuer(),
  );
  return found?.balance ?? null;
}

async function main() {
  const target = process.argv[2];

  heading('Funding a demo wallet');

  if (!target?.startsWith('G') || target.length !== 56) {
    console.error(
      `\n  ${red('Pass the address to fund.')}\n\n` +
        `    ${cyan('pnpm demo:fund G...')}\n\n` +
        `  ${dim('Copy it from Freighter — the classic G… address, not a C… contract address.')}\n`,
    );
    process.exit(1);
  }

  // ── The recipient has to exist and trust the assets first ──────────────────
  let recipient;
  try {
    recipient = await horizon.loadAccount(target);
  } catch {
    console.error(
      `\n  ${red('That account does not exist on testnet yet.')}\n\n` +
        `  Fund it first — the hub has a button for this, or:\n\n` +
        `    ${cyan(`curl "${FRIENDBOT}?addr=${target}"`)}\n`,
    );
    process.exit(1);
  }

  const missing = [TESOURO, USDC].filter((asset) => balanceOf(recipient, asset) === null);
  if (missing.length) {
    console.error(
      `\n  ${red('Missing trustlines:')} ${missing.map((a) => a.getCode()).join(', ')}\n\n` +
        `  A Stellar account cannot receive an asset it does not trust.\n` +
        `  Open the hub, connect this wallet, and use the "Sign trustline" prompt\n` +
        `  on ${bold('/onramp')} (TESOURO) and ${bold('/corridor')} (USDC). Then run this again.\n`,
    );
    process.exit(1);
  }

  console.log(`  recipient   ${cyan(target)}`);

  // ── Disposable funding account ────────────────────────────────────────────
  const existing = process.env.DEMO_FUNDER_SECRET;
  const funder = existing ? Keypair.fromSecret(existing) : Keypair.random();

  if (!existing) {
    console.log(`  funder      ${dim(funder.publicKey())} ${dim('(new)')}`);
    const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(funder.publicKey())}`);
    if (!res.ok) throw new Error(`Friendbot returned ${res.status}`);
    console.log(`  ${green('✓')} funded by friendbot`);
    console.log(
      `\n  ${dim('Reuse it next time by adding this to .env.local:')}\n` +
        `     DEMO_FUNDER_SECRET=${funder.secret()}\n`,
    );
  } else {
    console.log(`  funder      ${dim(funder.publicKey())}`);
  }

  const funderAccount = await horizon.loadAccount(funder.publicKey());
  const needsTrust = [TESOURO, USDC].filter((a) => balanceOf(funderAccount, a) === null);
  if (needsTrust.length) {
    await submit(funder, (b) => {
      for (const asset of needsTrust) b.addOperation(Operation.changeTrust({ asset }));
      return b;
    });
    console.log(`  ${green('✓')} funder trustlines: ${needsTrust.map((a) => a.getCode()).join(', ')}`);
  }

  // ── Buy on the open books and deliver ─────────────────────────────────────
  // A path payment sends straight to the recipient, so the asset never sits in
  // an intermediate balance. One transaction, atomic, no cleanup if it fails.
  for (const asset of [TESOURO, USDC]) {
    const held = balanceOf(recipient, asset) ?? '0';
    if (Number(held) > 0) {
      console.log(`  ${green('✓')} ${asset.getCode().padEnd(8)} already holds ${held}`);
      continue;
    }

    try {
      const paths = await horizon.strictSendPaths(Asset.native(), XLM_BUDGET, [asset]).call();
      const best = paths.records[0];

      if (!best) {
        console.log(
          `  ${yellow('!')} ${asset.getCode().padEnd(8)} no XLM → ${asset.getCode()} path on the books right now`,
        );
        continue;
      }

      // 3% slippage: these books are thin and a tight bound just fails.
      const destMin = (Number(best.destination_amount) * 0.97).toFixed(7);

      await submit(funder, (b) =>
        b.addOperation(
          Operation.pathPaymentStrictSend({
            sendAsset: Asset.native(),
            sendAmount: XLM_BUDGET,
            destination: target,
            destAsset: asset,
            destMin,
            // The route Horizon found, not an empty path. XLM→TESOURO goes
            // through an intermediate asset; sending `[]` asks the network for
            // a direct market that does not exist, and it fails with
            // `op_too_few_offers` — which reads like "no liquidity" and is
            // actually "you told me to ignore the route".
            path: toAssets(best.path),
          }),
        ),
      );

      console.log(
        `  ${green('✓')} ${asset.getCode().padEnd(8)} sent ~${Number(best.destination_amount).toFixed(2)} ${dim(`(${XLM_BUDGET} XLM via the DEX)`)}`,
      );
    } catch (e) {
      const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })
        ?.response?.data?.extras?.result_codes;
      console.log(
        `  ${yellow('!')} ${asset.getCode().padEnd(8)} ${codes ? JSON.stringify(codes) : (e as Error).message}`,
      );
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const after = await horizon.loadAccount(target);
  console.log(`\n  ${bold('Wallet now holds')}`);
  for (const b of after.balances) {
    console.log(`     ${('asset_code' in b ? b.asset_code : 'XLM').padEnd(9)} ${b.balance}`);
  }

  console.log(
    `\n  ${dim('Now walk it:')} ${cyan('/onramp')} ${dim('→')} ${cyan('/corridor')} ${dim('→')} ${cyan('/offramp')}\n`,
  );
}

main().catch((e) => {
  const extras = (e as { response?: { data?: { extras?: unknown } } })?.response?.data?.extras;
  console.error(`\n${red((e as Error).message)}`);
  if (extras) console.error(JSON.stringify(extras, null, 2));
  process.exit(1);
});
