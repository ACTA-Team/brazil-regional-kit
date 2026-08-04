import { describe, expect, it } from 'vitest';
import { RampError } from './errors';
import {
  classifyError,
  errorAnchor,
  errorCode,
  errorText,
  isDuplicateOrder,
  isRetryable,
} from './classify';

describe('errorText', () => {
  it('reads a plain string', () => {
    expect(errorText('boom')).toBe('boom');
  });

  it('reads an Error message', () => {
    expect(errorText(new Error('anchor timed out'))).toBe('anchor timed out');
  });

  it('reads a message off a bare object — API envelopes are not Errors', () => {
    expect(errorText({ code: 'UNKNOWN', message: 'from JSON' })).toBe('from JSON');
  });

  it('stringifies anything else rather than throwing', () => {
    expect(errorText(null)).toBe('null');
    expect(errorText(42)).toBe('42');
    expect(errorText({ nope: true })).toBe('[object Object]');
  });
});

describe('errorCode', () => {
  it('reads a known code', () => {
    expect(errorCode(new RampError({ code: 'QUOTE_EXPIRED', message: 'gone' }))).toBe(
      'QUOTE_EXPIRED',
    );
  });

  it('reads a known code off a plain object that crossed the wire', () => {
    expect(errorCode({ code: 'KYC_REQUIRED', message: 'verify' })).toBe('KYC_REQUIRED');
  });

  it('refuses a code it does not know — an anchor must not invent buckets', () => {
    expect(errorCode({ code: 'TEAPOT', message: 'short and stout' })).toBeNull();
  });

  it('is null for a codeless error', () => {
    expect(errorCode(new Error('plain'))).toBeNull();
    expect(errorCode('string')).toBeNull();
    expect(errorCode(null)).toBeNull();
  });
});

describe('errorAnchor', () => {
  it('reads the anchor that produced the failure', () => {
    const e = new RampError({ code: 'ANCHOR_UNAVAILABLE', message: 'down', anchorId: 'etherfuse' });
    expect(errorAnchor(e)).toBe('etherfuse');
  });

  it('treats an empty anchor id as absent', () => {
    expect(errorAnchor({ anchorId: '' })).toBeNull();
    expect(errorAnchor({})).toBeNull();
  });
});

describe('classifyError', () => {
  it('passes a classified anchor failure straight through', () => {
    const e = new RampError({ code: 'AMOUNT_OUT_OF_RANGE', message: 'too small' });
    expect(classifyError(e)).toBe('AMOUNT_OUT_OF_RANGE');
  });

  it.each([
    'User declined access',
    'Request rejected by user',
    'Transaction denied',
    'User cancelled the request',
    'Signing was canceled',
  ])('reads %j as the user cancelling, not as a failure', (message) => {
    expect(classifyError(new Error(message))).toBe('WALLET_REJECTED');
  });

  it('lets a cancellation outrank the chain error it arrived wrapped in', () => {
    // The wallet refuses, the submit path throws, and the transport tags it
    // CHAIN_ERROR. Reporting "the network refused it" would be a lie.
    const e = new RampError({ code: 'CHAIN_ERROR', message: 'User declined access' });
    expect(classifyError(e)).toBe('WALLET_REJECTED');
  });

  it('does not trip on a word that merely contains a rejection term', () => {
    expect(classifyError(new Error('the amount was undeclared'))).toBe('UNKNOWN');
    expect(classifyError(new Error('see our cancellation policy'))).toBe('UNKNOWN');
  });

  it('reports a browser with no connection as offline', () => {
    expect(classifyError(new Error('whatever'), { online: false })).toBe('OFFLINE');
  });

  it('reads a failed fetch as offline', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('OFFLINE');
    expect(classifyError(new TypeError('Load failed'))).toBe('OFFLINE');
  });

  it('does not call a non-TypeError offline just for saying "network"', () => {
    // An anchor replying "network error" is the ANCHOR being unreachable, and
    // it already said so with a code. Telling the user to check their wifi
    // would send them after the wrong problem.
    const e = new RampError({ code: 'ANCHOR_UNAVAILABLE', message: 'network error upstream' });
    expect(classifyError(e)).toBe('ANCHOR_UNAVAILABLE');
  });

  it('keeps a specific anchor code even when the client is offline', () => {
    const e = new RampError({ code: 'KYC_REQUIRED', message: 'verify first' });
    expect(classifyError(e, { online: false })).toBe('KYC_REQUIRED');
  });

  it('falls back to UNKNOWN rather than guessing', () => {
    expect(classifyError(new Error('something odd'))).toBe('UNKNOWN');
    expect(classifyError(null)).toBe('UNKNOWN');
    expect(classifyError({ code: 'UNKNOWN', message: 'unclassified' })).toBe('UNKNOWN');
  });
});

describe('isRetryable', () => {
  it('offers a retry where one could work', () => {
    expect(isRetryable('ANCHOR_UNAVAILABLE')).toBe(true);
    expect(isRetryable('QUOTE_EXPIRED')).toBe(true);
    expect(isRetryable('OFFLINE')).toBe(true);
  });

  it('does not offer a retry that would fail identically', () => {
    expect(isRetryable('KYC_REQUIRED')).toBe(false);
    expect(isRetryable('UNSUPPORTED_PAIR')).toBe(false);
    expect(isRetryable('WALLET_REJECTED')).toBe(false);
  });
});

describe('isDuplicateOrder', () => {
  it('recognises the collision the anchor offers no way to cancel', () => {
    const e = new RampError({
      code: 'INVALID_ORDER_STATE',
      message: 'an order for this bank account and amount already exists',
    });
    expect(isDuplicateOrder(e)).toBe(true);
  });

  it('does not claim every bad order state is a duplicate', () => {
    const e = new RampError({ code: 'INVALID_ORDER_STATE', message: 'order already settled' });
    expect(isDuplicateOrder(e)).toBe(false);
  });

  it('needs the code as well as the text', () => {
    expect(isDuplicateOrder(new Error('already exists'))).toBe(false);
  });
});
