import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentPromptContributor } from '@zhin.js/core';
import { mockCommMessage } from './helpers/mock-comm-message.js';
import { withMockHostRoot } from './helpers/mock-host-plugin.js';
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
        commMessage: mockCommMessage({ adapter: 'mock' }),
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
        commMessage: mockCommMessage({ adapter: 'mock' }),
      },
    });
    expect(sections.map(s => s.id)).toContain('hook.extra');
  });

  it('bridges legacy hooks to plugin ai.hook bus', async () => {
    const payloads: any[] = [];

    await withMockHostRoot(async (hostPlugin) => {
      hostPlugin.on('ai.hook', payload => payloads.push(payload));

      await resolveAgentPromptSections({
        sessionId: 'test:scene1:user1',
        ctx: {
          slot: 'orchestrator',
          commMessage: mockCommMessage({ adapter: 'mock', senderId: 'user1', sceneId: 'scene1' }),
        },
      });
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].source).toBe('ai-hook');
    expect(payloads[0].hookType).toBe('agent');
    expect(payloads[0].hookAction).toBe('prompt');
    expect(payloads[0].sessionId).toBe('test:scene1:user1');
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
        commMessage: mockCommMessage({ adapter: 'bad' }),
      },
    });
    expect(sections).toHaveLength(0);
  });
});
