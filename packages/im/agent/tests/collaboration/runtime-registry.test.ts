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
});
