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
      sender: { id: 'u1', role: ['admin'] },
    });
    expect(result.adapter).toBe('qq');
    expect(result.endpoint).toBe('e1');
    expect(result.scene).toEqual({ id: 'g1', type: 'group' });
    expect(result.sender).toEqual({ id: 'u1', role: ['admin'] });
  });

  it('projects Message-style object ($-prefixed fields)', () => {
    const result = toPermissionSubject({
      $adapter: 'discord',
      $endpoint: 'e2',
      $channel: { id: 'ch1', type: 'group', name: 'test' },
      $sender: { id: 'u2', name: 'Alice', role: ['admin'], permissions: ['manage'] },
    });
    expect(result.adapter).toBe('discord');
    expect(result.endpoint).toBe('e2');
    expect(result.scene).toEqual({ id: 'ch1', type: 'group', name: 'test' });
    expect(result.sender).toEqual({ id: 'u2', name: 'Alice', role: ['admin'], permissions: ['manage'] });
  });

  it('CommandSession-style takes precedence over $-prefixed', () => {
    const result = toPermissionSubject({
      adapter: 'qq',
      $adapter: 'discord',
    });
    expect(result.adapter).toBe('qq');
  });

  it('handles missing sender role gracefully', () => {
    const result = toPermissionSubject({
      $sender: { id: 'u3' },
    });
    expect(result.sender?.role).toEqual([]);
  });
});
