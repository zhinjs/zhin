/**
 * missions patch ACL unit tests.
 */
import { describe, it, expect } from 'vitest';
import { validateMissionStatePatch } from '../src/orchestrator/mission-patch-acl.js';

describe('mission patch ACL', () => {
  it('allows spec phase to set validation_spec_paths', () => {
    expect(validateMissionStatePatch('spec', {
      validation_spec_paths: ['.zhin/missions/x/spec.test.ts'],
    }).ok).toBe(true);
  });

  it('blocks develop phase from setting spec_dry_run_passed', () => {
    expect(validateMissionStatePatch('develop', {
      spec_dry_run_passed: true,
    }).ok).toBe(false);
  });
});
