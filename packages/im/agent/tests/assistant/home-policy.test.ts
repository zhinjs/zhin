import { describe, it, expect } from 'vitest';
import { checkHomeToolAccess } from '../../src/assistant/home-policy.js';

const policy = {
  requireMaster: true,
  confirmServices: ['lock', 'alarm_control_panel'],
};

describe('checkHomeToolAccess', () => {
  const masterCtx = { subjectId: '100', roles: ['master'] } as const;
  const otherCtx = { subjectId: '999', roles: ['user'] } as const;

  it('非 master 读操作被拒绝', () => {
    const d = checkHomeToolAccess('read', 'light.x', otherCtx, policy);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('master');
  });

  it('master 读 light 允许', () => {
    const d = checkHomeToolAccess('read', 'light.x', masterCtx, policy);
    expect(d.allowed).toBe(true);
  });

  it('master 写 lock 需审批', () => {
    const d = checkHomeToolAccess('write', 'lock.front', masterCtx, policy);
    expect(d.allowed).toBe(false);
    expect(d.needsOwnerApproval).toBe(true);
  });

  it('master 写 light 允许', () => {
    const d = checkHomeToolAccess('write', 'light.x', masterCtx, policy);
    expect(d.allowed).toBe(true);
  });

  it('fails closed when the authenticated principal has no authority role', () => {
    const d = checkHomeToolAccess('read', 'light.x', {
      subjectId: '100',
      roles: [],
    }, policy);
    expect(d).toMatchObject({ allowed: false, role: 'other' });
  });
});
