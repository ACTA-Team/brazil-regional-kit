import { describe, expect, it } from 'vitest';
import { resolveMode } from './mode';

describe('mode resolution', () => {
  it('defaults to mock so a clone with no credentials still runs', () => {
    expect(resolveMode({})).toBe('mock');
  });

  it('follows precedence: explicit → adapter env → global env → default', () => {
    expect(resolveMode({ explicit: 'live', adapterEnv: 'mock', globalEnv: 'mock' })).toBe('live');
    expect(resolveMode({ adapterEnv: 'live', globalEnv: 'mock' })).toBe('live');
    expect(resolveMode({ globalEnv: 'live' })).toBe('live');
  });

  it('ignores values that are not a mode', () => {
    expect(resolveMode({ adapterEnv: 'yes', globalEnv: 'live' })).toBe('live');
    expect(resolveMode({ globalEnv: 'production' })).toBe('mock');
  });

  it('is case and whitespace tolerant', () => {
    expect(resolveMode({ globalEnv: '  LIVE ' })).toBe('live');
  });

  /**
   * A `live` request with no API key would fail on every single call. Degrading
   * to mock turns a broken deployment into a working demo with an honest badge.
   */
  it('degrades to mock when live is impossible', () => {
    expect(resolveMode({ explicit: 'live', liveAvailable: false })).toBe('mock');
    expect(resolveMode({ globalEnv: 'live', liveAvailable: false })).toBe('mock');
  });

  it('does not interfere when live is available', () => {
    expect(resolveMode({ globalEnv: 'live', liveAvailable: true })).toBe('live');
  });
});
