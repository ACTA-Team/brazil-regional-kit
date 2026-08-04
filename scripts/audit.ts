/**
 * Dependency audit with a reviewed baseline.
 *
 *   pnpm audit:check          fail on any unreviewed advisory at high or above
 *   pnpm audit:check --level moderate
 *   pnpm audit:baseline       rewrite the baseline from the current tree
 *
 * Why not just `pnpm audit --audit-level=high`? Because every advisory in this
 * tree today is transitive and none is fixable without a major upgrade of
 * something the kit does not even use — the bulk arrives through Stellar
 * Wallets Kit's bundled WalletConnect stack, which this project explicitly
 * disables. A plain audit gate would therefore be red on day one, and a gate
 * that is always red is a gate everybody learns to ignore.
 *
 * So the rule here is "nothing NEW". Known advisories live in
 * `security/audit-baseline.json` with a written reason, in the repo, in review.
 * Anything not on that list fails the build. That keeps the signal while
 * refusing to pretend the known ones do not exist — `pnpm audit` still prints
 * them all, and the summary below always says how many are being carried.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bold, cyan, dim, green, heading, red, repoRoot, yellow } from './lib/env';

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'] as const;
type Severity = (typeof SEVERITIES)[number];

const BASELINE_PATH = join(repoRoot, 'security', 'audit-baseline.json');

interface Advisory {
  id: number;
  github_advisory_id: string;
  title: string;
  module_name: string;
  severity: Severity;
  vulnerable_versions: string;
  patched_versions: string;
  url: string;
}

interface BaselineEntry {
  package: string;
  severity: Severity;
  title: string;
  /** Why this is carried rather than fixed. Written by a human, reviewed in a PR. */
  reason: string;
}

interface Baseline {
  $comment: string;
  reviewed: string;
  acknowledged: Record<string, BaselineEntry>;
}

/**
 * `pnpm audit` exits non-zero when it finds anything, which is the normal case
 * here — so the exit code is ignored and the JSON body is what matters.
 */
function runAudit(): Advisory[] {
  let raw: string;
  try {
    /*
     * A fixed command string, run through the shell because `pnpm` is a .cmd
     * shim on Windows and Node refuses to spawn one directly. Nothing here is
     * interpolated — no user input reaches this line — so there is no injection
     * surface to speak of, which matters given what this script is for.
     */
    raw = execSync('pnpm audit --json', {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const stdout = (e as { stdout?: string }).stdout;
    if (!stdout) {
      console.error(red('  Could not run `pnpm audit`.'));
      console.error(dim(`  ${e instanceof Error ? e.message : String(e)}`));
      process.exit(2);
    }
    raw = stdout;
  }

  const parsed = JSON.parse(raw) as { advisories?: Record<string, Advisory> };
  return Object.values(parsed.advisories ?? {});
}

function readBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) {
    return { $comment: '', reviewed: 'never', acknowledged: {} };
  }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
}

const atLeast = (severity: Severity, floor: Severity) =>
  SEVERITIES.indexOf(severity) >= SEVERITIES.indexOf(floor);

const key = (a: Advisory) => a.github_advisory_id || String(a.id);

function writeBaseline(advisories: Advisory[], reason: string): void {
  const acknowledged: Record<string, BaselineEntry> = {};
  for (const a of [...advisories].sort((x, y) => key(x).localeCompare(key(y)))) {
    acknowledged[key(a)] = {
      package: a.module_name,
      severity: a.severity,
      title: a.title,
      reason,
    };
  }

  const baseline: Baseline = {
    $comment:
      'Advisories reviewed and accepted for now. Anything not listed here fails ' +
      '`pnpm audit:check`. Each entry needs a reason; regenerate with `pnpm audit:baseline` ' +
      'and then write real reasons before committing.',
    reviewed: new Date().toISOString().slice(0, 10),
    acknowledged,
  };

  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(green(`  Wrote ${Object.keys(acknowledged).length} advisories to the baseline.`));
  console.log(dim(`  ${BASELINE_PATH}`));
  console.log(yellow('\n  Now replace the placeholder reasons with real ones.\n'));
}

function main(): void {
  const args = process.argv.slice(2);
  const levelArg = args.indexOf('--level');
  const level = (levelArg === -1 ? 'high' : args[levelArg + 1]) as Severity;

  if (!SEVERITIES.includes(level)) {
    console.error(red(`  Unknown level "${level}". Use one of: ${SEVERITIES.join(', ')}`));
    process.exit(2);
  }

  const advisories = runAudit();

  if (args.includes('--write-baseline')) {
    writeBaseline(advisories, 'TODO: explain why this is carried rather than fixed.');
    return;
  }

  heading('Dependency audit');

  const baseline = readBaseline();
  const gating = advisories.filter((a) => atLeast(a.severity, level));
  const unreviewed = gating.filter((a) => !(key(a) in baseline.acknowledged));

  const counts = advisories.reduce<Record<string, number>>((acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1;
    return acc;
  }, {});

  const summary = SEVERITIES.filter((s) => counts[s])
    .reverse()
    .map((s) => `${counts[s]} ${s}`)
    .join(', ');

  console.log(`  ${bold('Found')}        ${summary || 'nothing'}`);
  console.log(`  ${bold('Gating at')}    ${level} and above (${gating.length} advisories)`);
  console.log(
    `  ${bold('Baseline')}     ${Object.keys(baseline.acknowledged).length} accepted, reviewed ${baseline.reviewed}`,
  );
  console.log('');

  // A baseline entry with no matching advisory means the dependency was fixed
  // or dropped. Not a failure, but it should not be carried forever.
  const present = new Set(advisories.map(key));
  const stale = Object.keys(baseline.acknowledged).filter((id) => !present.has(id));
  if (stale.length) {
    console.log(yellow(`  ${stale.length} baseline entries no longer apply — drop them:`));
    for (const id of stale) console.log(dim(`    ${id}  ${baseline.acknowledged[id]?.package}`));
    console.log('');
  }

  if (!unreviewed.length) {
    console.log(green(`  ✓ No unreviewed advisories at ${level} or above.`));
    if (gating.length) {
      console.log(
        dim(
          `    ${gating.length} known ones are being carried — see security/audit-baseline.json.`,
        ),
      );
    }
    console.log('');
    return;
  }

  console.log(red(`  ✗ ${unreviewed.length} unreviewed advisories at ${level} or above:\n`));
  for (const a of unreviewed) {
    console.log(`    ${red(a.severity.padEnd(9))} ${bold(a.module_name)}  ${a.title}`);
    console.log(dim(`      installed ${a.vulnerable_versions} → fixed in ${a.patched_versions}`));
    console.log(dim(`      ${a.url}`));
    console.log(dim(`      id: ${key(a)}`));
    console.log('');
  }

  console.log(`  ${cyan('Fix it')}, or if it genuinely cannot be fixed yet, add the id to`);
  console.log(`  security/audit-baseline.json with a reason and get that reviewed.\n`);

  process.exit(1);
}

main();
