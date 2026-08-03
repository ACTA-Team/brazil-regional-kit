/**
 * @brk/adapter-etherfuse — Etherfuse ramp adapter.
 *
 * BRL ↔ TESOURO over PIX, against the live sandbox or a faithful fixture-backed
 * simulator. Implements `RampAdapter` from `@brk/ramp-core`, so the router and
 * the UI treat it identically to any other anchor.
 */

export * from './api';
export * from './client';
export * from './mock';
export * from './pix';
export * from './adapter';
