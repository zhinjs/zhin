import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentPromptContributor } from '@zhin.js/core';
import {
  registerAgentPromptContributor,
  unregisterAgentPromptContributor,
  getAgentPromptContributor,
  clearAgentPromptContributors,
} from '../src/agent-prompt/registry.js';

describe('AgentPromptRegistry', () => {
  beforeEach(() => clearAgentPromptContributors());

  it('registers and retrieves by platform', () => {
    const c: AgentPromptContributor = {
      platform: 'test',
      buildSections: async () => null,
    };
    registerAgentPromptContributor(c);
    expect(getAgentPromptContributor('test')).toBe(c);
    unregisterAgentPromptContributor('test');
    expect(getAgentPromptContributor('test')).toBeUndefined();
  });
});
