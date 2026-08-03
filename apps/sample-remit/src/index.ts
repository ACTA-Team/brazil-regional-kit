/**
 * A second app, built only from the kit's packages.
 *
 *   pnpm sample
 *
 * The hub is where the kit was written, so of course it works there. This is a
 * different app — no React, no Next.js, no shared code with the hub at all —
 * that imports the same six packages and does real work with them:
 *
 *   1. registers four anchors behind one router
 *   2. asks an open-ended question and ranks every answer
 *   3. runs a full PIX on-ramp lifecycle
 *   4. prices a DEX swap against the live testnet order books
 *   5. checks a memo the way an anchor would
 *
 * If this file compiles and runs, the packages are genuinely reusable rather
 * than "extracted from an app but still married to it".
 */

import {
  BRL,
  TESOURO,
  USDC,
  assetCode,
  checkMemo,
  isTerminal,
  type RampAdapter,
} from '@brk/ramp-core';
import { createEtherfuseAdapter } from '@brk/adapter-etherfuse';
import { createKoyweAdapter, createMantecaAdapter } from '@brk/adapter-mocks';
import { createSepAdapter } from '@brk/adapter-sep';
import { createRampRouter } from '@brk/ramp-router';
import { quoteSwap } from '@brk/stablecoin-kit';

/** Any funded testnet account works; nothing here spends from it. */
const DEMO_ACCOUNT = 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4';

const ESC = String.fromCharCode(27);
const paint = (code: string, s: string) => `${ESC}[${code}m${s}${ESC}[0m`;
const bold = (s: string) => paint('1', s);
const dim = (s: string) => paint('2', s);
const green = (s: string) => paint('32', s);
const amber = (s: string) => paint('33', s);
const cyan = (s: string) => paint('36', s);

function heading(text: string) {
  console.log(`\n${bold(text)}\n${dim('─'.repeat(64))}`);
}

/** Pad the plain text, then colour it — padding a coloured string counts the
 *  escape bytes as width and shreds the sequence when it truncates. */
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);

async function main() {
  // ── 1. Wire up the anchors ─────────────────────────────────────────────────
  heading('1 · Register anchors behind one router');

  const etherfuse = createEtherfuseAdapter({ mode: 'mock' });
  const sep = createSepAdapter({
    mode: 'live',
    id: 'testanchor',
    name: 'SDF Test Anchor',
    defaultCountry: 'US',
  });

  // SEP anchors discover their own corridors from stellar.toml, so give it a
  // chance to before asking the router what it can do.
  await sep
    .discover()
    .catch(() => console.log(amber('  ! SEP discovery failed — continuing without it')));

  const adapters: RampAdapter[] = [etherfuse, sep, createMantecaAdapter(), createKoyweAdapter()];
  const router = createRampRouter({ adapters });

  for (const caps of router.capabilities()) {
    const tag = caps.mode === 'live' ? green(pad('live', 4)) : amber(pad('mock', 4));
    console.log(
      `  ${pad(caps.id, 12)} ${tag}  ${pad(`${caps.corridors.length} corridors`, 14)} ${dim(caps.countries.join(', '))}`,
    );
  }

  // ── 2. One question, every anchor ──────────────────────────────────────────
  heading('2 · "I have 500 BRL in Brazil — what can I get?"');

  const options = await router.route({ sellAsset: BRL, sellAmount: '500', country: 'BR' });

  for (const q of options.quotes) {
    const tag = q.mode === 'live' ? green(pad('live', 4)) : amber(pad('mock', 4));
    const badge = q.groupSize > 1 ? (q.best ? green('  ← best') : dim(`  −${q.worseByPct}%`)) : '';
    console.log(
      `  ${tag}  ${pad(q.anchorName, 20)} → ${pad(Number(q.buyAmount).toFixed(4), 14)} ${pad(assetCode(q.buyAsset), 8)} ${dim(`${q.latencyMs}ms`)}${badge}`,
    );
  }
  for (const a of options.anchors.filter((x) => x.outcome !== 'quoted')) {
    console.log(dim(`  skip  ${pad(a.anchorName, 20)} ${a.outcome}`));
  }
  console.log(dim(`  ${options.anchors.length} anchors in parallel · ${options.elapsedMs}ms`));

  // ── 3. A full on-ramp ──────────────────────────────────────────────────────
  heading('3 · Run a PIX on-ramp end to end');

  const quote = await etherfuse.getQuote({
    sellAsset: BRL,
    buyAsset: TESOURO,
    sellAmount: '500',
    account: DEMO_ACCOUNT,
    country: 'BR',
  });
  console.log(
    `  quote    R$ ${quote.sellAmount} → ${quote.buyAmount} TESOURO ${dim(`(fee ${quote.fee.amount})`)}`,
  );

  const order = await etherfuse.createOrder({ quoteId: quote.id, account: DEMO_ACCOUNT });
  console.log(`  order    ${order.id.slice(0, 8)} · ${order.status}`);

  const instructions = order.paymentInstructions;
  if (instructions?.type === 'pix') {
    console.log(`  pix      ${dim(`${instructions.code.slice(0, 46)}…`)}`);
  }

  await etherfuse.simulateFiatReceived(order.id);
  console.log(`  paid     ${dim('sandbox: fiat_received')}`);

  // Poll exactly the way a real integration would.
  let current = order;
  for (let i = 0; i < 12 && !isTerminal(current.status); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    current = await etherfuse.getOrder(order.id);
  }
  console.log(
    `  settled  ${green(current.status)} · ${current.buyAmount} ${assetCode(current.buyAsset)}`,
  );

  // ── 4. Live order books ────────────────────────────────────────────────────
  heading('4 · Price a swap against the real testnet DEX');

  try {
    const swap = await quoteSwap({ sellAsset: TESOURO, buyAsset: USDC, sellAmount: '100' });
    const label = swap.mode === 'dex' ? green('dex') : amber('simulated');
    console.log(
      `  ${label}  100 TESOURO → ${swap.buyAmount} USDC ${dim(`(min ${swap.destMin}, ${swap.path.length} hops)`)}`,
    );
    if (swap.reason) console.log(dim(`  ${swap.reason}`));
  } catch (e) {
    console.log(amber(`  ! ${(e as Error).message}`));
  }

  // ── 5. The memo trap ───────────────────────────────────────────────────────
  heading('5 · Memo safety (28 bytes, not 28 characters)');

  for (const memo of ['Para a familia', 'Transferência família', 'Para meus avós em Guadalajara']) {
    const check = checkMemo(memo);
    const verdict = pad(check.valid ? 'ok' : 'rejected', 10);
    console.log(
      `  ${check.valid ? green(verdict) : amber(verdict)} ${pad(`${check.bytes}b / ${memo.length}ch`, 14)} ${dim(`"${memo}"`)}`,
    );
  }

  console.log(
    `\n${bold('Every line above came from the published packages.')} ${dim('No hub code was imported.')}\n` +
      `${dim('  @brk/ramp-core · @brk/ramp-router · @brk/adapter-etherfuse')}\n` +
      `${dim('  @brk/adapter-sep · @brk/adapter-mocks · @brk/stablecoin-kit')}\n`,
  );
  console.log(dim(`  Hub demo: ${cyan('pnpm dev')}\n`));
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
});
