/**
 * @brk/adapter-mocks — production-shaped adapters for anchors that require
 * commercial onboarding.
 *
 * Manteca and Koywe have no self-service sandbox, and Koywe is not live in
 * Brazil yet. These adapters implement the same `RampAdapter` interface as the
 * live ones so the router can rank them, and mark every quote as simulated so
 * nobody mistakes them for market data. When credentials arrive, replacing the
 * fixture engine with an HTTP client is the only change needed.
 */

import type { MockAdapterOptions, MockAnchorFixture } from './engine';
import { MockAnchorAdapter } from './engine';
import fixtures from '../fixtures/anchors.json';

export * from './engine';

const ANCHORS = fixtures.anchors as unknown as Record<string, MockAnchorFixture>;

export const MOCK_ANCHOR_IDS = Object.keys(ANCHORS);

function build(id: string, options?: MockAdapterOptions): MockAnchorAdapter {
  const fixture = ANCHORS[id];
  if (!fixture) throw new Error(`No mock anchor fixture named "${id}"`);
  return new MockAnchorAdapter(id, fixture, options);
}

/** Manteca — Brazil (PIX) and Argentina (CBU/CVU), USDC on both sides. */
export const createMantecaAdapter = (options?: MockAdapterOptions) => build('manteca', options);

/** Koywe — Mexico (SPEI), Chile, Colombia and Peru, USDC on both sides. */
export const createKoyweAdapter = (options?: MockAdapterOptions) => build('koywe', options);

/** Every simulated anchor, for registering the full set at once. */
export const createAllMockAdapters = (options?: MockAdapterOptions): MockAnchorAdapter[] =>
  MOCK_ANCHOR_IDS.map((id) => build(id, options));
