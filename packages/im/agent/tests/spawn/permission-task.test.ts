import { describe, it, expect } from 'vitest';
import {
  assertSpawnAgentAllowed,
  evaluatePermissionTask,
  filterAgentsForSpawnDescription,
  matchesPermissionTaskPattern,
} from '../../src/spawn/permission-task.js';

describe('permission.task', () => {
  it('allows all when rules are absent', () => {
    expect(evaluatePermissionTask(undefined, 'architect')).toBe('allow');
    expect(filterAgentsForSpawnDescription(['a', 'b'], undefined)).toEqual(['a', 'b']);
  });

  it('matches glob patterns case-insensitively', () => {
    expect(matchesPermissionTaskPattern('arch*', 'Architect')).toBe(true);
    expect(matchesPermissionTaskPattern('dev', 'architect')).toBe(false);
  });

  it('uses last matching rule and defaults to deny', () => {
    const rules = { '*': 'deny', 'arch*': 'allow', 'architect': 'deny' } as const;
    expect(evaluatePermissionTask(rules, 'architect')).toBe('deny');
    expect(evaluatePermissionTask(rules, 'arch-lite')).toBe('allow');
    expect(evaluatePermissionTask(rules, 'dev')).toBe('deny');
  });

  it('filters spawn description agents', () => {
    const rules = { '*': 'deny', 'pm': 'allow', 'dev*': 'allow' } as const;
    expect(filterAgentsForSpawnDescription(['pm', 'dev', 'architect'], rules)).toEqual(['pm', 'dev']);
  });

  it('assertSpawnAgentAllowed returns error for denied agents', () => {
    const rules = { '*': 'deny', 'pm': 'allow' } as const;
    expect(assertSpawnAgentAllowed('pm', rules)).toBeUndefined();
    expect(assertSpawnAgentAllowed('dev', rules)).toContain('not allowed');
  });
});
