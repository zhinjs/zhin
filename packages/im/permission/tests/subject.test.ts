import { describe, it, expect } from 'vitest';
import { toPermissionSubject } from '../src/subject.js';

describe('toPermissionSubject', () => {
  it('returns empty for null/undefined', () => {
    expect(toPermissionSubject(null)).toEqual({});
    expect(toPermissionSubject(undefined)).toEqual({});
  });

  it('projects CommandSession-style object', () => {
    const result = toPermissionSubject({
      adapter: 'qq',
      endpoint: 'e1',
      scene: { id: 'g1', type: 'group' },
      sender: { id: 'u1', chatRole: 'admin' },
    });
    expect(result.adapter).toBe('qq');
    expect(result.endpoint).toBe('e1');
    expect(result.scene).toEqual({ id: 'g1', type: 'group' });
    expect(result.sender).toEqual({ id: 'u1', chatRole: 'admin' });
  });

  it('keeps valid chat role levels only when a chat role is set', () => {
    expect(toPermissionSubject({ sender: { id: 'u1', chatRole: 'owner', chatRoleLevels: { owner: 'global', admin: 'nowhere' } } }).sender)
      .toEqual({ id: 'u1', chatRole: 'owner', chatRoleLevels: { owner: 'global' } });
    expect(toPermissionSubject({ sender: { id: 'u1', chatRoleLevels: { owner: 'global' } } }).sender).toEqual({ id: 'u1' });
  });

  it('projects canonical Runtime Message fields: chat role and normalized platform standing only', () => {
    const result = toPermissionSubject({
      clientAdapter: 'discord',
      endpointId: 'e2',
      conversation: { endpoint: { adapter: 'root/discord', id: 'capability' }, id: 'ch1', kind: 'group', name: 'test' },
      sender: { id: 'u2', name: 'Alice', chatRole: 'trusted', roles: ['owner'],
        platform: { standing: 'admin', roles: [{ id: 'r1' }, { bad: true }], permissions: ['manage', ''] } },
      metadata: { senderRole: 'admin', roles: ['owner'] },
    });
    expect(result.adapter).toBe('discord');
    expect(result.endpoint).toBe('e2');
    expect(result.scene).toEqual({ id: 'ch1', type: 'group', name: 'test' });
    expect(result.sender).toEqual({ id: 'u2', name: 'Alice', chatRole: 'trusted',
      platform: { standing: 'admin', roles: [{ id: 'r1' }], permissions: ['manage'] } });
  });

  it('never reads roles from metadata or legacy role strings (ADR 0056)', () => {
    const result = toPermissionSubject({
      conversation: { endpoint: { adapter: 'telegram', id: 'runtime-endpoint' }, id: 'group-1', kind: 'group' },
      sender: { id: 'u2', roles: ['administrator'], chatRole: 'master' },
      metadata: { role: 'owner', roles: ['moderator'], senderPermissions: ['pin_messages'] },
    });
    expect(result).toMatchObject({ adapter: 'telegram', endpoint: 'runtime-endpoint', sender: { id: 'u2' } });
    expect(result.sender).toEqual({ id: 'u2' });
  });

  it('CommandSession-style takes precedence over canonical fallback fields', () => {
    const result = toPermissionSubject({
      adapter: 'qq',
      clientAdapter: 'discord',
    });
    expect(result.adapter).toBe('qq');
  });

  it('handles missing sender role gracefully', () => {
    const result = toPermissionSubject({
      sender: { id: 'u3' },
    });
    expect(result.sender?.chatRole).toBeUndefined();
    expect(result.sender?.platform).toBeUndefined();
  });
});
