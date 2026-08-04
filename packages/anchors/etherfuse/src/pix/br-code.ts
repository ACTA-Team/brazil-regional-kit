/**
 * PIX "copia e cola" payload builder (EMV® QR Code — BR Code).
 *
 * Used by the mock transport so the sandbox demo shows a structurally real BR
 * Code rather than a lorem-ipsum string: same TLV layout, same field ids, same
 * CRC16 check that a Brazilian bank app validates before it will even display
 * the payment. The PIX key is an obviously non-routable sandbox address, so the
 * code parses but resolves to nothing — which is exactly what a demo wants.
 *
 * Spec: Banco Central do Brasil, Manual de Padrões para Iniciação do PIX.
 */

/** Emit one `id + 2-digit length + value` triple. */
function tlv(id: string, value: string): string {
  const length = value.length.toString().padStart(2, '0');
  return `${id}${length}${value}`;
}

/**
 * CRC16/CCITT-FALSE — polynomial 0x1021, initial value 0xFFFF, no reflection.
 * The BR Code spec computes it over the whole payload *including* the literal
 * `6304` tag of the CRC field itself.
 */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Strip accents and anything the BR Code charset rejects, then clamp length. */
function sanitize(value: string, maxLength: number): string {
  return (
    value
      // NFD splits "São" into "Sa" + combining tilde + "o"; the character class
      // below then drops the combining mark, leaving plain ASCII.
      .normalize('NFD')
      .replace(/[^A-Za-z0-9 .-]/g, '')
      .trim()
      .slice(0, maxLength)
  );
}

export interface PixPayloadInput {
  /** PIX key: email, CPF/CNPJ, phone or random UUID. */
  key: string;
  amount: string;
  merchantName: string;
  merchantCity: string;
  /** Reference id echoed back by the bank — the anchor reconciles on this. */
  txid: string;
  description?: string;
}

export function buildPixPayload(input: PixPayloadInput): string {
  const merchantAccount =
    tlv('00', 'br.gov.bcb.pix') +
    tlv('01', input.key) +
    (input.description ? tlv('02', sanitize(input.description, 72)) : '');

  const additionalData = tlv('05', sanitize(input.txid, 25) || '***');

  const payload =
    tlv('00', '01') + // payload format indicator
    tlv('01', '12') + // dynamic: single-use QR
    tlv('26', merchantAccount) +
    tlv('52', '0000') + // merchant category: unspecified
    tlv('53', '986') + // currency: BRL
    tlv('54', Number(input.amount).toFixed(2)) +
    tlv('58', 'BR') +
    tlv('59', sanitize(input.merchantName, 25) || 'RECEBEDOR') +
    tlv('60', sanitize(input.merchantCity, 15) || 'SAO PAULO') +
    tlv('62', additionalData);

  // The CRC covers the payload plus its own `63` + `04` header.
  const withCrcHeader = `${payload}6304`;
  return `${withCrcHeader}${crc16(withCrcHeader)}`;
}

/** Verify a BR Code's checksum — used by tests and by the fixture recorder. */
export function isValidPixPayload(payload: string): boolean {
  if (payload.length < 8) return false;
  const body = payload.slice(0, -4);
  const provided = payload.slice(-4).toUpperCase();
  return body.endsWith('6304') && crc16(body) === provided;
}
