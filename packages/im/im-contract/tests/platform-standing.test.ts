import { describe, expect, it } from 'vitest';
import { isPlatformManager, normalizePlatformStanding } from '../src/index.js';

describe('normalizePlatformStanding', () => {
  it('keeps a valid standing and freezes it', () => {
    const standing = normalizePlatformStanding({
      standing: 'admin',
      roles: [{ id: '1', name: 'Mods' }, { id: '1' }, { id: 2 }, { name: 'no id' }, null],
      permissions: ['ban_members', 'ban_members', '', 3],
    });
    expect(standing).toEqual({
      standing: 'admin',
      roles: [{ id: '1', name: 'Mods' }, { id: '2' }],
      permissions: ['ban_members', '3'],
    });
    expect(Object.isFrozen(standing)).toBe(true);
    expect(Object.isFrozen(standing!.roles)).toBe(true);
  });

  it('rejects unknown standings', () => {
    expect(normalizePlatformStanding({ standing: 'master' })).toBeUndefined();
    expect(normalizePlatformStanding(['owner'])).toBeUndefined();
    expect(normalizePlatformStanding(undefined)).toBeUndefined();
  });

  it('omits empty roles and permissions', () => {
    expect(normalizePlatformStanding({ standing: 'member', roles: [], permissions: [] })).toEqual({ standing: 'member' });
  });

  it('isPlatformManager covers owner and admin only', () => {
    expect(isPlatformManager({ standing: 'owner' })).toBe(true);
    expect(isPlatformManager({ standing: 'admin' })).toBe(true);
    expect(isPlatformManager({ standing: 'member' })).toBe(false);
    expect(isPlatformManager(undefined)).toBe(false);
  });
});
