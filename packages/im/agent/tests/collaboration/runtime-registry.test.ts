import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntimeRegistry } from '../../src/collaboration/runtime-registry.js';

describe('AgentRuntimeRegistry', () => {
  let registry: AgentRuntimeRegistry;

  beforeEach(() => {
    registry = new AgentRuntimeRegistry();
  });

  it('returns default for unknown endpoint', () => {
    const agent = { id: 'primary' } as never;
    registry.registerDefault(agent);
    expect(registry.getForEndpoint('any')).toBe(agent);
  });

  it('returns endpoint-specific runtime when registered', () => {
    const primary = { id: 'primary' } as never;
    const secondary = { id: 'secondary' } as never;
    registry.registerDefault(primary);
    registry.registerForEndpoint('bot-b', secondary);
    expect(registry.getForEndpoint('bot-a')).toBe(primary);
    expect(registry.getForEndpoint('bot-b')).toBe(secondary);
  });

  it('reveals the previous generation after the current one is disposed', () => {
    const previous = { id: 'previous' } as never;
    const next = { id: 'next' } as never;
    const disposePrevious = registry.registerDefault(previous);
    const disposeNext = registry.registerDefault(next);

    disposePrevious();
    expect(registry.getDefault()).toBe(next);
    disposeNext();
    expect(registry.getDefault()).toBeNull();
  });
});
