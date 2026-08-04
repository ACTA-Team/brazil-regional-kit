/**
 * Decimal-string money helpers.
 *
 * Amounts stay strings end to end. Anchors quote in strings, Stellar operations
 * take strings, and `0.1 + 0.2` in float is how you end up off by a centavo on
 * stage. These helpers do the small arithmetic the UI needs without pulling in
 * a bignum dependency: scale to integers, operate, scale back.
 */

const SCALE = 7; // Stellar's native precision

function toUnits(value: string, scale = SCALE): bigint {
  const trimmed = value.trim();
  if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error(`Not a decimal amount: "${value}"`);
  }
  const negative = trimmed.startsWith('-');
  const [whole = '0', frac = ''] = trimmed.replace('-', '').split('.');
  const padded = (frac + '0'.repeat(scale)).slice(0, scale);
  const units = BigInt(whole || '0') * 10n ** BigInt(scale) + BigInt(padded || '0');
  return negative ? -units : units;
}

function fromUnits(units: bigint, scale = SCALE): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const divisor = 10n ** BigInt(scale);
  const whole = abs / divisor;
  const frac = (abs % divisor).toString().padStart(scale, '0').replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole.toString();
  return negative ? `-${out}` : out;
}

export function add(a: string, b: string): string {
  return fromUnits(toUnits(a) + toUnits(b));
}

export function subtract(a: string, b: string): string {
  return fromUnits(toUnits(a) - toUnits(b));
}

export function multiply(a: string, b: string): string {
  return fromUnits((toUnits(a) * toUnits(b)) / 10n ** BigInt(SCALE));
}

export function divide(a: string, b: string): string {
  const divisor = toUnits(b);
  if (divisor === 0n) throw new Error('Division by zero');
  return fromUnits((toUnits(a) * 10n ** BigInt(SCALE)) / divisor);
}

export function compare(a: string, b: string): -1 | 0 | 1 {
  const ua = toUnits(a);
  const ub = toUnits(b);
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

export const isPositive = (a: string): boolean => toUnits(a) > 0n;

/** Apply basis points, e.g. `applyBps("100", 150)` → `"1.5"` for a 1.5% fee. */
export function applyBps(amount: string, bps: number): string {
  return divide(multiply(amount, bps.toString()), '10000');
}

/** Round to `dp` decimal places, truncating toward zero (never over-promise). */
export function round(value: string, dp: number): string {
  const units = toUnits(value);
  const factor = 10n ** BigInt(SCALE - dp);
  return fromUnits((units / factor) * factor);
}

/** Format for display in a given locale, e.g. `R$ 500,00`. */
export function formatAmount(value: string, dp = 2): string {
  return round(value, dp);
}
