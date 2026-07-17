import { describe, expect, it } from 'vitest';
import { definePage, normalizePageMetadata, pageRoute } from '../src/index.js';

describe('Console contract', () => {
  it('normalizes author metadata without adding route authority', () => {
    expect(definePage({ title: 'Status', requiredRoles: ['admin', 'admin'] })).toEqual({
      title: 'Status',
      icon: undefined,
      order: undefined,
      hideInNav: undefined,
      requiredPermissions: [],
      requiredRoles: ['admin'],
    });
    expect(normalizePageMetadata('service-status', undefined)).toMatchObject({
      title: 'Service Status',
      order: 100,
      hideInNav: false,
    });
  });

  it('derives routes only from Root-relative ownership', () => {
    expect(pageRoute('root', 'root', 'home')).toBe('/p-home');
    expect(pageRoute('root/a/b', 'root', 'status')).toBe('/a/b/p-status');
    expect(() => pageRoute('other/a', 'root', 'status')).toThrow('outside Root');
  });

  it('rejects metadata that would otherwise be silently ignored', () => {
    expect(() => definePage({ route: '/custom' } as never)).toThrow('Unknown Page metadata: route');
  });
});
