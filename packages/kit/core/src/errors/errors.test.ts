import { describe, expect, it } from 'vitest';
import { RampError, isRampError, toRampError } from './errors';

describe('RampError', () => {
  it('defaults retryable from the code', () => {
    expect(new RampError({ code: 'ANCHOR_UNAVAILABLE', message: 'x' }).retryable).toBe(true);
    expect(new RampError({ code: 'UNSUPPORTED_PAIR', message: 'x' }).retryable).toBe(false);
  });

  it('never puts the raw anchor payload on the wire', () => {
    const err = new RampError({
      code: 'INVALID_REQUEST',
      message: 'nope',
      raw: { customerTaxId: '123', email: 'someone@example.com' },
    });
    expect(JSON.stringify(err.toJSON())).not.toContain('someone@example.com');
    expect(err.toJSON()).not.toHaveProperty('raw');
  });
});

describe('isRampError', () => {
  it('recognises its own errors', () => {
    expect(isRampError(new RampError({ code: 'UNKNOWN', message: 'x' }))).toBe(true);
    expect(isRampError(new Error('plain'))).toBe(false);
    expect(isRampError(null)).toBe(false);
    expect(isRampError('string')).toBe(false);
  });

  /**
   * A bundler can produce two copies of this module, and then `instanceof`
   * fails for an error this very file threw — quietly downgrading its code to
   * UNKNOWN and breaking every caller that branches on the code. The brand is
   * what stops that, so it needs a test that does not use the real class.
   */
  it('recognises an error from another copy of the module', () => {
    const fromOtherCopy = Object.assign(new Error('A pending order already exists'), {
      [Symbol.for('brk.RampError')]: true,
      code: 'INVALID_ORDER_STATE',
      name: 'RampError',
    });

    expect(isRampError(fromOtherCopy)).toBe(true);
    // And it must survive normalization with its code intact.
    expect(toRampError(fromOtherCopy).code).toBe('INVALID_ORDER_STATE');
  });
});

describe('toRampError', () => {
  it('passes a RampError through unchanged', () => {
    const original = new RampError({ code: 'QUOTE_EXPIRED', message: 'gone' });
    expect(toRampError(original)).toBe(original);
  });

  it('wraps a plain error as UNKNOWN', () => {
    expect(toRampError(new Error('boom'), 'etherfuse')).toMatchObject({
      code: 'UNKNOWN',
      anchorId: 'etherfuse',
      message: 'boom',
    });
  });

  it('classifies an abort as the anchor being unavailable', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(toRampError(abort).code).toBe('ANCHOR_UNAVAILABLE');
  });

  /**
   * Regression: a protocol client such as `Sep38Client` serves whichever anchor
   * it was pointed at, so it throws untagged. The adapter wrapping it supplies
   * the id — and dropping it left every SEP anchor failure anonymous in the UI.
   */
  it('tags an untagged RampError with the anchor the caller named', () => {
    const untagged = new RampError({ code: 'UNSUPPORTED_PAIR', message: 'no such pair' });
    const tagged = toRampError(untagged, 'testanchor');

    expect(tagged.anchorId).toBe('testanchor');
    expect(tagged.code).toBe('UNSUPPORTED_PAIR');
    expect(tagged.message).toBe('no such pair');
  });

  it('preserves the diagnostic payload while tagging', () => {
    const untagged = new RampError({
      code: 'INVALID_REQUEST',
      message: 'bad amount',
      status: 400,
      raw: { error: 'bad amount' },
      retryable: true,
    });
    const tagged = toRampError(untagged, 'testanchor');

    expect(tagged).toMatchObject({ status: 400, retryable: true });
    expect(tagged.raw).toEqual({ error: 'bad amount' });
  });

  it('never overwrites an anchor id the error already carries', () => {
    const original = new RampError({
      code: 'AUTH_FAILED',
      message: 'nope',
      anchorId: 'etherfuse',
    });

    expect(toRampError(original, 'testanchor')).toBe(original);
    expect(original.anchorId).toBe('etherfuse');
  });
});
