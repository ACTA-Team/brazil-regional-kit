/**
 * Minimal .env loader for the CLI scripts.
 *
 * Dependency-free on purpose: these scripts run before anyone has a reason to
 * trust the project's node_modules, and `.env.local` parsing is twenty lines.
 * Precedence matches Next.js: `.env.local` wins over `.env`, and a variable
 * already present in the real environment wins over both.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parse(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

export function loadEnv(): void {
  for (const file of ['.env', '.env.local']) {
    const path = join(repoRoot, file);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parse(readFileSync(path, 'utf8')))) {
      // A real environment variable always wins — that is how CI overrides work.
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  Missing ${name}.\n  ${hint}\n`);
    process.exit(1);
  }
  return value;
}

// ── Console helpers ───────────────────────────────────────────────────────────

const supportsColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const ESC = '[';
const paint = (code: string) => (s: string) => (supportsColor ? `${ESC}${code}m${s}${ESC}0m` : s);

export const bold = paint('1');
export const dim = paint('2');
export const green = paint('32');
export const yellow = paint('33');
export const red = paint('31');
export const cyan = paint('36');

export function heading(text: string): void {
  console.log(`\n${bold(text)}\n${dim('─'.repeat(Math.min(text.length, 60)))}`);
}
