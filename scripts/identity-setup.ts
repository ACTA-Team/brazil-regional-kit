/**
 * One-time issuer identity for the hub.
 *
 *   pnpm setup:identity
 *
 * The hub signs onboarding attestations as an issuer, and an ACTA issuer is a
 * Stellar account plus a registered `did:stellar` whose on-chain controller is
 * that account. This creates both, once, and prints the two values to save.
 *
 * Run it ONCE per environment. The DID is what every attestation the hub has
 * ever signed points back to; minting a new one does not migrate them, it
 * orphans them — every user who was attested reads as un-attested and has to go
 * round again. The script refuses to run a second time without --force, for
 * exactly that reason.
 *
 * It is also why the hub never mints an issuer DID on demand: a server that
 * quietly created one whenever it noticed it had none would do this to itself on
 * every restart.
 *
 * Testnet only. It funds the account with friendbot, which does not exist on
 * mainnet, and issuance costs 5 XLM per credential there.
 */

import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { ActaIdentityClient, DID_RESOLVER_URL, walletKeyToMultikey } from '@brk/identity-kit';
import { bold, cyan, dim, green, heading, loadEnv, red, yellow } from './lib/env';

loadEnv();

const force = process.argv.includes('--force');

const FRIENDBOT = 'https://friendbot.stellar.org';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Enough for the registration plus a few credentials at 5 XLM each. */
const MIN_BALANCE_XLM = 30;

async function fund(publicKey: string): Promise<void> {
  const response = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(publicKey)}`);

  // Already funded is a 400 with "createAccountAlreadyExist" — a fine outcome,
  // not a failure. Only a genuine refusal should stop the script.
  if (!response.ok) {
    const body = await response.text();
    if (!/exist/i.test(body)) {
      throw new Error(`Friendbot refused to fund ${publicKey}: ${body.slice(0, 200)}`);
    }
  }
}

async function balanceOf(publicKey: string): Promise<number> {
  const horizon = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
  const response = await fetch(`${horizon}/accounts/${publicKey}`);
  if (!response.ok) return 0;

  const account = (await response.json()) as {
    balances?: Array<{ asset_type: string; balance: string }>;
  };
  const native = account.balances?.find((b) => b.asset_type === 'native');
  return Number(native?.balance ?? 0);
}

async function main() {
  heading('ACTA issuer identity');

  const existingDid = process.env.IDENTITY_ISSUER_DID;
  const existingSecret = process.env.IDENTITY_ISSUER_SECRET;

  if (existingDid && existingSecret && !force) {
    const client = new ActaIdentityClient({
      resolverUrl: process.env.DID_RESOLVER_URL,
      network: 'testnet',
    });
    const record = await client.getDidRecord(existingDid);
    const expected = Keypair.fromSecret(existingSecret).publicKey();

    console.log(`\n${yellow('Already set up.')}\n`);
    console.log(`  ${dim('issuer DID')}   ${existingDid}`);
    console.log(`  ${dim('controller')}   ${expected}`);
    console.log(
      `  ${dim('on-chain')}     ${
        !record
          ? red('NOT REGISTERED — the DID does not resolve')
          : record.controller === expected
            ? green('registered, controller matches')
            : red(`controller is ${record.controller}, not your key`)
      }\n`,
    );
    console.log(
      dim(
        '  Reuse it. Every attestation this hub has signed points at this DID;\n' +
          '  a new one orphans all of them.\n' +
          '  Pass --force only if you accept losing them.\n',
      ),
    );

    // A mismatch is worth failing over: the credentials API rejects issuance
    // with `issuerDid_controller_mismatch`, and that error reads like a bad key.
    if (record && record.controller !== expected) process.exit(1);
    return;
  }

  // ── 1. The issuer account ──────────────────────────────────────────────────
  const keypair = force || !existingSecret ? Keypair.random() : Keypair.fromSecret(existingSecret);
  const publicKey = keypair.publicKey();

  heading('1. Funding the issuer account');
  console.log(`\n  ${dim('account')}  ${publicKey}`);

  await fund(publicKey);
  const balance = await balanceOf(publicKey);
  console.log(`  ${dim('balance')}  ${balance} XLM`);

  if (balance < MIN_BALANCE_XLM) {
    console.log(
      `\n  ${yellow(`Under ${MIN_BALANCE_XLM} XLM.`)} Issuance costs 5 XLM per credential on\n` +
        `  testnet, so top this account up before a demo:\n\n` +
        `     ${cyan(`${FRIENDBOT}?addr=${publicKey}`)}\n`,
    );
  }

  // ── 2. The DID ─────────────────────────────────────────────────────────────
  //
  // The account's own Ed25519 key becomes the DID's verification key, and goes
  // into `assertionMethod` as well as `authentication` — an issuer without an
  // assertion key cannot sign credentials, and W3C verifiers reject what it does
  // sign. The client handles that; this only has to sign the transaction.
  heading('2. Registering the did:stellar');

  const client = new ActaIdentityClient({
    resolverUrl: process.env.DID_RESOLVER_URL,
    network: 'testnet',
  });

  /*
   * The issuer needs a second key.
   *
   * ACTA's docs call one key in both `authentication` and `assertionMethod`
   * the idiomatic issuer shape; the deployed registry rejects exactly that with
   * `duplicate_key (#9)`. So the assertion key is generated here, and its
   * secret is printed alongside the account's — a DID that advertises a key
   * nobody holds would be claiming an ability the issuer does not have.
   */
  const assertionKeypair = Keypair.random();

  const prepared = await client.prepareDidRegistration(publicKey, {
    assertionKeyMultibase: walletKeyToMultikey(assertionKeypair.publicKey()),
  });
  const tx = TransactionBuilder.fromXDR(
    prepared.xdr,
    prepared.networkPassphrase || TESTNET_PASSPHRASE,
  );
  tx.sign(keypair);

  const { txId } = await client.submitDidTx(tx.toXDR());

  console.log(`\n  ${dim('did')}  ${bold(prepared.did ?? '(none returned)')}`);
  console.log(`  ${dim('tx')}   ${txId}`);

  // Read it back rather than trusting the submission: a DID that does not
  // resolve is one the credentials API will reject at the first issuance, and
  // finding that out here is much cheaper than finding it out on stage.
  const record = prepared.did ? await client.getDidRecord(prepared.did) : null;
  console.log(
    `  ${dim('resolves')} ${
      record?.controller === publicKey
        ? green('yes, and the controller matches')
        : red('NO — check the resolver and try again')
    }\n`,
  );

  // ── 3. What to save ────────────────────────────────────────────────────────
  heading('3. Save these');

  console.log(`\n  Put these in ${bold('.env.local')} — never in .env.example, never committed:\n`);
  console.log(`     IDENTITY_ISSUER_SECRET=${keypair.secret()}`);
  console.log(`     IDENTITY_ISSUER_ASSERTION_SECRET=${assertionKeypair.secret()}`);
  console.log(`     IDENTITY_ISSUER_DID=${prepared.did}\n`);
  console.log(`  Then add your ACTA key and flip the layer to live:\n`);
  console.log(`     ACTA_API_KEY=...`);
  console.log(`     IDENTITY_MODE=live\n`);
  console.log(
    dim(
      `  Anyone can check the result: ${DID_RESOLVER_URL}/1.0/identifiers/${prepared.did}\n\n` +
        '  The secret above signs credential issuance and can spend this\n' +
        '  account. It is testnet and disposable — treat it as a secret anyway,\n' +
        '  and never prefix it NEXT_PUBLIC_.\n',
    ),
  );
}

main().catch((e) => {
  console.error(`\n${red((e as Error).message)}\n`);
  process.exit(1);
});
