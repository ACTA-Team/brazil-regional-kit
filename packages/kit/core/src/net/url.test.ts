/**
 * These helpers exist because the obvious regex for the job is a denial of
 * service. So the tests come in two halves: the trimming has to be correct, and
 * it has to stay linear — a correctness-only test would pass just as happily
 * against the `replace(/\/+$/, '')` this replaced.
 */

import { describe, expect, it } from 'vitest';
import { stripTrailingSlashes, toHomeDomain } from './url';

describe('stripTrailingSlashes', () => {
  it('removes a single trailing slash', () => {
    expect(stripTrailingSlashes('https://anchor.test/sep38/')).toBe('https://anchor.test/sep38');
  });

  it('removes several', () => {
    expect(stripTrailingSlashes('https://anchor.test/sep38///')).toBe('https://anchor.test/sep38');
  });

  it('leaves a value that has none untouched', () => {
    const url = 'https://anchor.test/sep38';
    expect(stripTrailingSlashes(url)).toBe(url);
  });

  /** Slashes inside the URL are structural — only the tail is noise. */
  it('does not touch interior slashes', () => {
    expect(stripTrailingSlashes('https://anchor.test/a/b/c/')).toBe('https://anchor.test/a/b/c');
  });

  it('handles a value that is nothing but slashes', () => {
    expect(stripTrailingSlashes('///')).toBe('');
  });

  it('handles an empty string', () => {
    expect(stripTrailingSlashes('')).toBe('');
  });

  it('matches what the old regex produced, for every ordinary shape', () => {
    for (const input of [
      'https://a.test',
      'https://a.test/',
      'https://a.test//',
      'https://a.test/path/',
      '/leading',
      '',
      '/',
      'no-slashes-at-all',
    ]) {
      expect(stripTrailingSlashes(input)).toBe(input.replace(/\/+$/, ''));
    }
  });
});

describe('toHomeDomain', () => {
  it('strips https and a trailing slash', () => {
    expect(toHomeDomain('https://testanchor.stellar.org/')).toBe('testanchor.stellar.org');
  });

  it('strips http too', () => {
    expect(toHomeDomain('http://anchor.test')).toBe('anchor.test');
  });

  it('leaves a bare domain alone', () => {
    expect(toHomeDomain('anchor.test')).toBe('anchor.test');
  });

  it('only strips the scheme from the front', () => {
    expect(toHomeDomain('anchor.test/https://x')).toBe('anchor.test/https://x');
  });

  it('matches what the old regex pair produced', () => {
    for (const input of [
      'https://a.test/',
      'http://a.test//',
      'a.test',
      'https://a.test/path/',
      '',
    ]) {
      expect(toHomeDomain(input)).toBe(input.replace(/^https?:\/\//, '').replace(/\/+$/, ''));
    }
  });
});

/**
 * The reason this module exists.
 *
 * `\/+$` is polynomial: it tries every start position, and at each one matches
 * a run of slashes then backtracks through it hunting for the end of the
 * string. Measured on the regex this replaced — 10k slashes 28ms, 20k 109ms,
 * 40k 441ms, 80k 1.8s. Quadratic.
 *
 * These strings come from an anchor's `stellar.toml`, which the router fetches
 * from third parties it does not control, so that is reachable by a hostile
 * anchor and it blocks the whole event loop.
 *
 * The assertion is on scaling rather than on a wall-clock budget: a fixed
 * millisecond threshold would flake on a loaded CI runner, while the shape of
 * the curve is the actual property. Quadratic growth over this range would be
 * a ~64x jump; linear is ~8x.
 */
describe('resistance to a hostile value', () => {
  const timeFor = (n: number): number => {
    // Slashes NOT at the end, which is the expensive case for the old regex.
    const hostile = `https://anchor.test/${'/'.repeat(n)}x`;
    const started = performance.now();
    stripTrailingSlashes(hostile);
    return performance.now() - started;
  };

  it('scales linearly, not quadratically, in the number of slashes', () => {
    // Warm up so JIT compilation is not counted as growth.
    timeFor(1_000);

    const small = Math.max(timeFor(10_000), 0.01);
    const large = Math.max(timeFor(80_000), 0.01);

    // 8x the input. Linear predicts ~8x, quadratic ~64x. Anything under 25x
    // rules out the quadratic behaviour with room for scheduling noise.
    expect(large / small).toBeLessThan(25);
  });

  it('trims a pathological value promptly', () => {
    const hostile = `https://anchor.test/${'/'.repeat(200_000)}x`;
    const started = performance.now();

    expect(stripTrailingSlashes(hostile)).toBe(hostile);
    // The old regex needed seconds for this. Generous, so it fails only on a
    // genuine algorithmic regression rather than on a busy runner.
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('still trims correctly when the slashes are at the end', () => {
    const hostile = `https://anchor.test${'/'.repeat(200_000)}`;
    expect(stripTrailingSlashes(hostile)).toBe('https://anchor.test');
  });
});
