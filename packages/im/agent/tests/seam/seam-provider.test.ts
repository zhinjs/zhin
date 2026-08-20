import { describe, it, expect } from 'vitest';
import { SeamProviderRegistry } from '../../src/seam/seam-provider.js';
import type { SeamProvider } from '../../src/seam/seam-provider.js';

interface TestProvider extends SeamProvider {
  id: string;
  description: string;
}

describe('SeamProviderRegistry', () => {
  it('registers and retrieves providers in global scope', () => {
    const registry = new SeamProviderRegistry<TestProvider>();
    const provider: TestProvider = { id: 'test:provider', description: 'Test provider' };

    registry.register('global', provider);

    const retrieved = registry.getFor('global');
    expect(retrieved).toContain(provider);
  });

  it('registers and retrieves providers in named scope', () => {
    const registry = new SeamProviderRegistry<TestProvider>();
    const p = { id: 'p', description: 'P' };

    registry.register('agent-1', p);

    expect(registry.getFor('agent-1')).toContain(p);
    expect(registry.getFor('agent-2')).not.toContain(p);
  });

  it('includes global providers when querying scoped', () => {
    const registry = new SeamProviderRegistry<TestProvider>();
    const global = { id: 'global:svc', description: 'Global' };
    const scoped = { id: 'scoped:svc', description: 'Scoped' };

    registry.register('global', global);
    registry.register('agent-1', scoped);

    const all = registry.getFor('agent-1');
    expect(all).toContain(global);
    expect(all).toContain(scoped);
  });

  it('does not include scoped providers in global query', () => {
    const registry = new SeamProviderRegistry<TestProvider>();
    const scoped = { id: 'scoped:svc', description: 'Scoped' };

    registry.register('agent-1', scoped);

    expect(registry.getFor('global')).not.toContain(scoped);
  });

  it('finds provider by predicate', () => {
    const registry = new SeamProviderRegistry<TestProvider>();
    const p1 = { id: 'p1', description: 'P1' };
    const p2 = { id: 'p2', description: 'P2' };

    registry.register('global', p1);
    registry.register('global', p2);

    const found = registry.find('global', (p) => p.id === 'p2');
    expect(found).toBe(p2);
  });

  it('returns null when no provider matches predicate', () => {
    const registry = new SeamProviderRegistry<TestProvider>();
    registry.register('global', { id: 'p1', description: 'P1' });

    const found = registry.find('global', (p) => p.id === 'nonexistent');
    expect(found).toBeNull();
  });

  it('gets provider by id', () => {
    const registry = new SeamProviderRegistry<TestProvider>();
    const p = { id: 'target', description: 'Target' };
    registry.register('global', p);
    registry.register('global', { id: 'other', description: 'Other' });

    expect(registry.getById('global', 'target')).toBe(p);
    expect(registry.getById('global', 'missing')).toBeNull();
  });

  it('removes a provider', () => {
    const registry = new SeamProviderRegistry<TestProvider>();
    const p = { id: 'to-remove', description: 'To remove' };
    registry.register('global', p);

    const removed = registry.remove('global', 'to-remove');
    expect(removed).toBe(true);
    expect(registry.getFor('global')).not.toContain(p);
  });

  it('returns false when removing a non-existent provider', () => {
    const registry = new SeamProviderRegistry<TestProvider>();
    expect(registry.remove('global', 'nonexistent')).toBe(false);
  });

  it('supports symbol scopes', () => {
    const registry = new SeamProviderRegistry<TestProvider>();
    const sym = Symbol('agent-scope');
    const p = { id: 'sym:svc', description: 'Sym' };

    registry.register(sym, p);
    expect(registry.getFor(sym)).toContain(p);
  });
});
