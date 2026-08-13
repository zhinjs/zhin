import { describe, expect, it } from 'vitest';
import { buildChatPathSystemPrompt } from '../../src/prompt/assembly.js';

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
});
