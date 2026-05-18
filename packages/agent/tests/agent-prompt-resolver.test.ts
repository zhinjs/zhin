import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentPromptContributor } from '@zhin.js/core';
import {
  clearAgentPromptContributors,
  registerAgentPromptContributor,
} from '../src/agent-prompt/registry.js';
import { resolveAgentPromptSections } from '../src/agent-prompt/resolver.js';
import { clearAIHooks, registerAIHook } from '../src/hooks.js';

describe('resolveAgentPromptSections', () => {
  beforeEach(() => {
    clearAgentPromptContributors();
    clearAIHooks();
  });

  it('returns contributor sections for matching platform', async () => {
    registerAgentPromptContributor({
      platform: 'mock',
      buildSections: async () => [{
        id: 'platform.mock.orchestrator',
        body: 'mock hint',
        priority: 10,
      }],
    });
    const sections = await resolveAgentPromptSections({
      ctx: {
        slot: 'orchestrator',
        toolContext: { platform: 'mock' },
        toolSearch: true,
      },
    });
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toContain('mock hint');
  });

  it('merges hook-appended sections', async () => {
    registerAgentPromptContributor({
      platform: 'mock',
      buildSections: async () => [{ id: 'a', body: 'from adapter' }],
    });
    registerAIHook('agent:prompt', async (event) => {
      const ctx = event.context as { sections: { id: string; body: string }[] };
      ctx.sections.push({ id: 'hook.extra', body: 'from hook' });
    });
    const sections = await resolveAgentPromptSections({
      ctx: {
        slot: 'orchestrator',
        toolContext: { platform: 'mock' },
        toolSearch: true,
      },
    });
    expect(sections.map(s => s.id)).toContain('hook.extra');
  });

  it('isolates contributor errors', async () => {
    const bad: AgentPromptContributor = {
      platform: 'bad',
      buildSections: async () => {
        throw new Error('boom');
      },
    };
    registerAgentPromptContributor(bad);
    const sections = await resolveAgentPromptSections({
      ctx: {
        slot: 'orchestrator',
        toolContext: { platform: 'bad' },
        toolSearch: true,
      },
    });
    expect(sections).toHaveLength(0);
  });
});
