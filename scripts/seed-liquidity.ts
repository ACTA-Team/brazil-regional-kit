/**
 * Guarantee a TESOURO/USDC market on testnet.
 *
 *   pnpm seed:liquidity
 *
 * At the time of writing the corridor's swap fills against real order books —
 * someone else is making that market. That is a dependency on strangers, and
 * testnet order books empty out without warning. This script stands up our own
 * market maker so the demo does not rely on anyone's goodwill:
 *
 *   1. fund a throwaway account with friendbot
 *   2. trustlines for TESOURO and USDC
 *   3. buy inventory of both by path-paying XLM through the existing books
 *   4. place passive offers on both sides
 *
 * Testnet only. The secret it prints is disposable by construction — never put
 * a mainnet key in MARKET_MAKER_SECRET.
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

const TESOURO_ASSET = new Asset('TESOURO', TESOURO_ISSUER_TESTNET);
const USDC_ASSET = new Asset('USDC', USDC_ISSUER_TESTNET);

/** XLM spent buying each side of the book. Friendbot gives 10,000. */
const XLM_PER_SIDE = '2000';
/** Spread around mid, in basis points, on each side. */
const SPREAD_BPS = 150;

async function submit(keypair: Keypair, build: (b: TransactionBuilder) => TransactionBuilder) {
  const account = await horizon.loadAccount(keypair.publicKey());
  const tx = build(new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK }))
    .setTimeout(120)
    .build();
  tx.sign(keypair);
  return horizon.submitTransaction(tx);
}

async function balance(address: string, asset: Asset): Promise<string> {
  const account = await horizon.loadAccount(address);
  const found = account.balances.find((b) =>
    asset.isNative()
      ? b.asset_type === 'native'
      : 'asset_code' in b &&
        b.asset_code === asset.getCode() &&
        b.asset_issuer === asset.getIssuer(),
  );
  return found?.balance ?? '0';
}

async function bookDepth(selling: Asset, buying: Asset) {
  const book = await horizon.orderbook(selling, buying).limit(10).call();
  return { bids: book.bids.length, asks: book.asks.length };
}

async function main() {
  heading('Seeding a TESOURO/USDC market on testnet');

  const existing = process.env.MARKET_MAKER_SECRET;
  const keypair = existing ? Keypair.fromSecret(existing) : Keypair.random();
  const address = keypair.publicKey();

  console.log(`  market maker: ${cyan(address)}`);
  if (!existing) {
    console.log(`  ${yellow('New account.')} Add this to .env.local to reuse it:\n`);
    console.log(`     MARKET_MAKER_SECRET=${keypair.secret()}\n`);
  }

  // ── 1. Fund ────────────────────────────────────────────────────────────────
  try {
    await horizon.loadAccount(address);
    console.log(
      `  ${green('✓')} already funded ${dim(`(${await balance(address, Asset.native())} XLM)`)}`,
    );
  } catch {
    const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(address)}`);
    if (!res.ok) throw new Error(`Friendbot returned ${res.status}`);
    console.log(`  ${green('✓')} funded by friendbot`);
  }

  // ── 2. Trustlines ──────────────────────────────────────────────────────────
  const account = await horizon.loadAccount(address);
  const missing = [TESOURO_ASSET, USDC_ASSET].filter(
    (asset) =>
      !account.balances.some(
        (b) =>
          'asset_code' in b &&
          b.asset_code === asset.getCode() &&
          b.asset_issuer === asset.getIssuer(),
      ),
  );

  if (missing.length) {
    await submit(keypair, (b) => {
      for (const asset of missing) b.addOperation(Operation.changeTrust({ asset }));
      return b;
    });
    console.log(`  ${green('✓')} trustlines: ${missing.map((a) => a.getCode()).join(', ')}`);
  } else {
    console.log(`  ${green('✓')} trustlines already in place`);
  }

  // ── 3. Inventory ───────────────────────────────────────────────────────────
  // Buy through whatever books already exist. If a side has no path we say so
  // and carry on — a one-sided book still beats an empty one.
  for (const asset of [USDC_ASSET, TESOURO_ASSET]) {
    const held = await balance(address, asset);
    if (Number(held) > 0) {
      console.log(`  ${green('✓')} ${asset.getCode()} inventory: ${held}`);
      continue;
    }

    try {
      const paths = await horizon.strictSendPaths(Asset.native(), XLM_PER_SIDE, [asset]).call();
      const best = paths.records[0];
      if (!best) {
        console.log(`  ${yellow('!')} no XLM → ${asset.getCode()} path; skipping that side`);
        continue;
      }

      const destMin = (Number(best.destination_amount) * 0.97).toFixed(7);
      await submit(keypair, (b) =>
        b.addOperation(
          Operation.pathPaymentStrictSend({
            sendAsset: Asset.native(),
            sendAmount: XLM_PER_SIDE,
            destination: address,
            destAsset: asset,
            destMin,
            path: [],
          }),
        ),
      );
      console.log(
        `  ${green('✓')} bought ${best.destination_amount} ${asset.getCode()} ${dim(`for ${XLM_PER_SIDE} XLM`)}`,
      );
    } catch (e) {
      console.log(`  ${yellow('!')} could not buy ${asset.getCode()}: ${(e as Error).message}`);
    }
  }

  // ── 4. Offers ──────────────────────────────────────────────────────────────
  const tesouroHeld = await balance(address, TESOURO_ASSET);
  const usdcHeld = await balance(address, USDC_ASSET);

  if (Number(tesouroHeld) === 0 && Number(usdcHeld) === 0) {
    console.log(`\n  ${red('No inventory on either side — nothing to quote.')}\n`);
    return;
  }

  // Mid comes from whatever the book already says; if it says nothing, fall
  // back to the ratio of what we managed to buy.
  let mid =
    Number(usdcHeld) > 0 && Number(tesouroHeld) > 0 ? Number(usdcHeld) / Number(tesouroHeld) : 0.2;

  try {
    const path = await horizon.strictSendPaths(TESOURO_ASSET, '100', [USDC_ASSET]).call();
    const quoted = path.records[0];
    if (quoted) mid = Number(quoted.destination_amount) / 100;
  } catch {
    /* keep the fallback */
  }

  const sellPrice = (mid * (1 + SPREAD_BPS / 10_000)).toFixed(7);
  const buyPrice = (mid * (1 - SPREAD_BPS / 10_000)).toFixed(7);

  await submit(keypair, (b) => {
    // Sell TESOURO for USDC, slightly above mid.
    if (Number(tesouroHeld) > 0) {
      b.addOperation(
        Operation.createPassiveSellOffer({
          selling: TESOURO_ASSET,
          buying: USDC_ASSET,
          amount: (Number(tesouroHeld) * 0.9).toFixed(7),
          price: sellPrice,
        }),
      );
    }
    // Sell USDC for TESOURO, slightly below mid — the other side of the book.
    if (Number(usdcHeld) > 0) {
      b.addOperation(
        Operation.createPassiveSellOffer({
          selling: USDC_ASSET,
          buying: TESOURO_ASSET,
          amount: (Number(usdcHeld) * 0.9).toFixed(7),
          price: (1 / Number(buyPrice)).toFixed(7),
        }),
      );
    }
    return b;
  });

  const depth = await bookDepth(TESOURO_ASSET, USDC_ASSET);
  console.log(
    `  ${green('✓')} offers placed ${dim(`mid ${mid.toFixed(7)}, spread ${SPREAD_BPS}bps`)}`,
  );
  console.log(`  ${green('✓')} TESOURO/USDC book: ${depth.bids} bids, ${depth.asks} asks`);
  console.log(
    `\n  ${bold('The corridor swap now has a market that does not depend on anyone else.')}\n`,
  );
}

main().catch((e) => {
  const extras = (e as { response?: { data?: { extras?: unknown } } })?.response?.data?.extras;
  console.error(`\n${red((e as Error).message)}`);
  if (extras) console.error(JSON.stringify(extras, null, 2));
  process.exit(1);
});
