/**
 * @brk/adapter-etherfuse — Etherfuse ramp adapter.
 *
 * BRL ↔ TESOURO over PIX, against the live sandbox or a faithful fixture-backed
 * simulator. Implements `RampAdapter` from `@brk/ramp-core`, so the router and
 * the UI treat it identically to any other anchor.
 */

export * from './api/api';
export * from './api/client';
export * from './api/mock';
export * from './pix/br-code';
export * from './adapter/etherfuse-adapter';
