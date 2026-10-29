import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { buildRichSystemPrompt } from '../../src/prompt/system-prompt.js';
import { structuredReplyInstruction } from '../../src/outbound/structured-reply.js';
import { estimatePromptTokens } from '../../src/prompt/estimate-tokens.js';

describe('built-in IM prompt cost (#949)', () => {
  // The runtime section embeds `CWD`; pin it so the budget does not depend on where the checkout lives.
  beforeEach(() => { vi.spyOn(process, 'cwd').mockReturnValue('/home/runner/work/zhin/zhin'); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(['private', 'group'] as const)('keeps %s instructions compact without omitting the security or workspace sections', scope => {
    const prompt = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
      orchestratorSdk: 'openai-compatible',
      turn: {
        origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope, sceneId: 'scene' },
        principal: { subjectId: 'sender', roles: ['user'] }, session: { key: 'test' },
      },
    });
    // Baseline: ~1,180 estimated tokens, excluding message schema/tool catalogs.
    // This is a regression budget, not a runtime truncation limit or provider billing.
    expect(estimatePromptTokens(prompt)).toBeLessThanOrEqual(900);
    for (const rule of ['<critical_rules>', '# Workspace tasks in chat', '# Chat style', '# Security',
      'SOUL.md', 'spawn_task', 'ask_user', 'master', 'trusted', 'user', 'ZHIN_NEEDS_OWNER:',
      '/approve', 'policyBlocked', 'sensitive', 'tool output']) {
      expect(prompt).toContain(rule);
    }
  });

  it('keeps the default final-reply guidance compact alongside its unchanged schema', () => {
    // Baseline: 579 estimated tokens of guidance, in addition to the JSON Schema.
    expect(estimatePromptTokens(structuredReplyInstruction())).toBeLessThanOrEqual(410);
  });
});
