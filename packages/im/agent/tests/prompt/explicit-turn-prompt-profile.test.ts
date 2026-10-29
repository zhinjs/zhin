import { describe, expect, it } from 'vitest';
import { buildAgentPathSystemPrompt, buildChatPathSystemPrompt, buildMultimodalVisionSystemPrompt, describeAgentPathPromptSections } from '../../src/prompt/assembly.js';
import { PromptAssemblyRegistry } from '../../src/prompt/prompt-assembly-registry.js';
import { DEFAULT_CONFIG, SECTION_SEP } from '../../src/config/index.js';
import { estimatePromptTokens } from '../../src/prompt/estimate-tokens.js';

describe('explicit Turn prompt profile', () => {
  it('builds a native Schedule prompt without ambient context or IM identity', () => {
    const prompt = buildChatPathSystemPrompt({
      getTurnActiveSkills: () => '',
      globalContext: '',
      bootstrapContext: 'workspace rules',
    } as never, 'interactive persona must not leak', {
      kind: 'schedule',
      jobId: 'daily-report',
      prompt: 'publish report',
      createdBy: { userId: 'owner', roles: ['trusted'] },
      security: { execPreset: 'readonly', rejectOwnerApproval: true, allowedDomains: [] },
    });

    expect(prompt).toContain('任务 ID: daily-report');
    expect(prompt).toContain('创建者: owner (trusted)');
    expect(prompt).toContain('workspace rules');
    expect(prompt).not.toContain('interactive persona must not leak');
    expect(prompt).not.toContain('platform:');
    expect(prompt).not.toContain('endpoint:');
  });

  it('injects turn-owned Prompt Sections even when the turn exposes no tools', () => {
    const registry = new PromptAssemblyRegistry();
    registry.register('root:business-rules', {
      layer: 'context',
      title: 'Business rules',
      content: 'Use the canonical product vocabulary.',
      order: 70,
      retention: 'preferred',
    });

    const prompt = buildChatPathSystemPrompt({
      config: { systemPromptMaxChars: 10_000 },
    } as never, 'Helpful assistant.', { kind: 'interactive' }, { registry });

    expect(prompt).toContain('Helpful assistant.');
    expect(prompt).toContain('Use the canonical product vocabulary.');
  });

  it('keeps turn capability instructions in the system prompt across rich, chat, vision and schedule entry points', async () => {
    const registry = new PromptAssemblyRegistry();
    const capabilities = '## Active specialist: researcher\nVerify primary sources.';
    const platformRules = '# Platform rules\nUse the current endpoint; never guess a recipient.';
    registry.register('§11_capabilities', {
      layer: 'system', kind: 'platform', title: 'Turn capabilities', content: capabilities,
      order: 9, budgetOrder: 155, retention: 'preferred',
    });
    registry.register('adapter:platform', {
      layer: 'tools', title: 'Platform rules', content: platformRules,
      order: 70, placement: 'tail', retention: 'preferred',
    });
    const host = {
      config: DEFAULT_CONFIG, getTurnActiveSkills: () => '', globalContext: '', bootstrapContext: '',
      skillRegistry: null, skillsSummaryXML: '', getTurnProvider: () => ({ name: 'test' }),
      llmRuntime: { model: () => ({ contextWindow: 128_000 }) },
    } as never;
    const turn = {
      origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'group' },
      principal: { subjectId: 'sender', roles: ['user'] }, session: { key: 'session' },
    } as const;
    const runtime = { registry, modelId: 'configured-model', providerAlias: 'provider', modelSdk: 'google' };
    const schedule = {
      kind: 'schedule', jobId: 'report', prompt: 'write report',
      security: { execPreset: 'readonly', rejectOwnerApproval: true, allowedDomains: [] },
    } as const;
    const rich = await buildAgentPathSystemPrompt(host, {
      profile: { kind: 'interactive' }, turn, content: 'research', sessionId: 'session', personaEnhanced: 'persona', runtime,
    });
    const chat = buildChatPathSystemPrompt(host, 'persona', { kind: 'interactive' }, runtime);
    const vision = await buildMultimodalVisionSystemPrompt(host, {
      turn, sessionId: 'session', textContent: 'research', personaEnhanced: 'persona', runtime,
    });
    const scheduledChat = buildChatPathSystemPrompt(host, 'persona', schedule, runtime);
    const scheduledAgent = await buildAgentPathSystemPrompt(host, {
      profile: schedule, turn, content: 'research', sessionId: 'session', personaEnhanced: 'persona', runtime,
    });

    for (const prompt of [rich, chat, vision, scheduledChat, scheduledAgent]) {
      expect(prompt.endsWith(platformRules)).toBe(true);
      expect(prompt.split(capabilities)).toHaveLength(2);
      expect(prompt.indexOf(platformRules)).toBeGreaterThan(prompt.indexOf(capabilities));
      expect(prompt.split('Model: provider/configured-model')).toHaveLength(2);
      expect(prompt.split('Sdk: google')).toHaveLength(2);
      expect(prompt.split(`Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`)).toHaveLength(2);
      expect(prompt.indexOf('Model:')).toBeLessThan(prompt.indexOf(capabilities));
    }
    expect(rich.indexOf('# Security')).toBeLessThan(rich.indexOf(capabilities));
    expect(chat.indexOf('# Safety')).toBeLessThan(chat.indexOf(capabilities));
    expect(scheduledChat.indexOf('# 安全约束')).toBeLessThan(scheduledChat.indexOf(capabilities));

    const sections = await describeAgentPathPromptSections(host, {
      turn, content: 'research', sessionId: 'session', runtime,
    });
    const runtimeText = rich.split(SECTION_SEP).find(text => text.startsWith('# Runtime'))!;
    expect(sections.find(section => section.id === '§1_runtime')).toEqual({
      id: '§1_runtime', kind: 'environment', weight: 160, chars: runtimeText.length, trimmed: false,
      approxChars: runtimeText.length, approxTokens: estimatePromptTokens(runtimeText),
    });
  });
});
