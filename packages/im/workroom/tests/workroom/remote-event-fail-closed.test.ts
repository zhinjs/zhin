import { describe, expect, it } from 'vitest';
import {
  isWorkroomEventType,
  validatePayload,
} from '../../src/workroom/journal/event-validation.js';

/**
 * C4a: remote dispatch is frozen (A2A extension) but the Kernel still owns the
 * `remote_dispatch.requested` fact. Journal history containing it must keep
 * failing closed rather than being silently ignored.
 */
describe('remote_dispatch.requested history stays fail-closed', () => {
  it('is still a known Kernel event type, unknown types are not', () => {
    expect(isWorkroomEventType('remote_dispatch.requested')).toBe(true);
    expect(isWorkroomEventType('remote_dispatch.unknown')).toBe(false);
  });

  it('rejects a payload with missing fields', () => {
    expect(() => validatePayload('remote_dispatch.requested', {}, 4)).toThrow();
  });

  it('rejects a payload with undeclared keys', () => {
    expect(() => validatePayload('remote_dispatch.requested', { forged: true }, 4))
      .toThrow('Invalid Workroom event payload keys');
  });
});
