import { describe, expect, it } from 'vitest';
import {
  createWorkroomGovernedDispatchReason,
} from '../../src/plugin-runtime/workroom-governed-dispatch-reasons.js';

describe('Workroom governed dispatch reason adapter', () => {
  it.each([
    ['disclosure_recipient_revoked', false, 'rematerialize'],
    ['disclosure_manifest_stale', false, 'rematerialize'],
    ['disclosure_manifest_expired', false, 'rematerialize'],
    ['payload_vault_key_unavailable', true, 'operator_repair'],
    ['generation_retired', false, 'new_generation'],
  ] as const)('maps %s identically for Projection, Console, model and A2A', (code, retryable, action) => {
    const reason = createWorkroomGovernedDispatchReason(code);
    expect(reason).toEqual({ version: 1, code, retryable, action });
    expect(JSON.stringify({ projection: reason, console: reason, model: reason, a2a: reason }))
      .not.toContain('body');
  });

  it('rejects caller-invented reason strings', () => {
    expect(() => createWorkroomGovernedDispatchReason('allow_anything'))
      .toThrow('unknown');
  });
});
