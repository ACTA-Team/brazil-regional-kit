import { describe, expect, it } from 'vitest';
import { buildPixPayload, crc16, isValidPixPayload } from './pix';

const BASE = {
  key: 'sandbox@brazil-regional-kit.demo',
  amount: '500',
  merchantName: 'BRK Sandbox Ramps',
  merchantCity: 'Sao Paulo',
  txid: 'BRK123ABC',
};

/**
 * A bank app validates the BR Code's structure and checksum before it will even
 * display the payment. If these tests pass, the demo shows something a real
 * Brazilian bank would parse rather than reject.
 */
describe('BR Code structure', () => {
  const payload = buildPixPayload(BASE);

  it('starts with the payload format indicator', () => {
    expect(payload.startsWith('000201')).toBe(true);
  });

  it('marks the code as single-use', () => {
    expect(payload).toContain('010212');
  });

  it('declares BRL and Brazil', () => {
    expect(payload).toContain('5303986'); // currency 986 = BRL
    expect(payload).toContain('5802BR');
  });

  it('formats the amount to two decimals', () => {
    expect(payload).toContain('5406500.00');
  });

  it('embeds the PIX key under the BCB GUI', () => {
    expect(payload).toContain('0014br.gov.bcb.pix');
    expect(payload).toContain(BASE.key);
  });

  it('carries the transaction reference the anchor reconciles on', () => {
    expect(payload).toContain('BRK123ABC');
  });
});

describe('CRC16/CCITT-FALSE', () => {
  it('matches the published check value for "123456789"', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('validates a freshly built payload', () => {
    expect(isValidPixPayload(buildPixPayload(BASE))).toBe(true);
  });

  it('detects a tampered payload', () => {
    const payload = buildPixPayload(BASE);
    const tampered = `${payload.slice(0, -1)}${payload.endsWith('0') ? '1' : '0'}`;
    expect(isValidPixPayload(tampered)).toBe(false);
  });

  it('detects a tampered amount', () => {
    const payload = buildPixPayload(BASE).replace('5406500.00', '5406900.00');
    expect(isValidPixPayload(payload)).toBe(false);
  });

  it('rejects anything too short to hold a checksum', () => {
    expect(isValidPixPayload('0002')).toBe(false);
  });
});

describe('character sanitisation', () => {
  it('strips accents rather than emitting bytes the charset forbids', () => {
    const payload = buildPixPayload({
      ...BASE,
      merchantName: 'São Paulo Rampas',
      merchantCity: 'São Paulo',
    });
    expect(payload).toContain('Sao Paulo');
    expect(payload).not.toContain('ã');
    expect(isValidPixPayload(payload)).toBe(true);
  });

  it('clamps the merchant name to the 25-character field', () => {
    const payload = buildPixPayload({
      ...BASE,
      merchantName: 'A name far longer than the twenty five character limit',
    });
    expect(payload).toContain('5925');
    expect(isValidPixPayload(payload)).toBe(true);
  });

  it('still produces a valid code when fields are empty', () => {
    const payload = buildPixPayload({ ...BASE, merchantName: '', merchantCity: '', txid: '' });
    expect(payload).toContain('RECEBEDOR');
    expect(payload).toContain('***');
    expect(isValidPixPayload(payload)).toBe(true);
  });
});
