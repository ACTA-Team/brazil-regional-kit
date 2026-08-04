/**
 * @brk/ramp-core — the contract every ramp adapter in this kit implements.
 *
 * Depends on nothing. Import it to write an adapter for a new anchor, or to
 * consume quotes and orders without caring which anchor produced them.
 */

export * from './assets/assets';
export * from './errors/errors';
export * from './memo/memo';
export * from './contract/mode';
export * from './assets/money';
export * from './contract/types';
