import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { buildRichSystemPrompt, describePromptSectionsForDebug, fillPromptSlots } from '../../src/prompt/system-prompt.js';
import type { TurnContextView } from '../../src/context/turn-envelope.js';

const SOUL = '## SOUL.md\n\n我是群里的老朋友，说话随意。';
const base = {
  config: DEFAULT_CONFIG,
  skillRegistry: null,
  skillsSummaryXML: '',
  activeSkillsContext: '',
  bootstrapContext: SOUL,
} as const;
const principal = { subjectId: '1', roles: [] };
const imTurn: TurnContextView = {
  origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'g' },
  principal, session: { key: 's' },
};
const httpTurn: TurnContextView = { origin: { kind: 'http', sessionId: 'h' }, principal, session: { key: 'h' } } as TurnContextView;
const ids = (turn: TurnContextView) => describePromptSectionsForDebug({ ...base, turn }).map(section => section.id);

describe('chat turn prompt', () => {
  it('leads IM turns with the workspace persona and drops coding-workflow sections', () => {
    const chat = ids(imTurn);
    // ADR 0041: fixed kind order system → environment → role_rules; the persona leads role_rules.
    expect(chat.slice(0, 2)).toEqual(['§1b_critical_rules', '§4_security']);
    expect(chat.slice(chat.indexOf('§1_persona'), chat.indexOf('§1_persona') + 2)).toEqual(['§1_persona', '§11_bootstrap']);
    for (const id of ['§5_error_handling', '§5b_editing', '§5c_task_completion', '§5d_code_references', '§5e_memory_instructions', '§5f_context_mode']) {
      expect(chat).not.toContain(id);
    }
    const prompt = buildRichSystemPrompt({ ...base, turn: imTurn });
    expect(prompt).toContain('# Chat style');
    expect(prompt).toContain('# Workspace tasks in chat');
    expect(prompt).not.toContain('Keep response under 4 lines');
    expect(prompt).not.toContain('override everything');
    expect(prompt.indexOf('我是群里的老朋友')).toBeLessThan(prompt.indexOf('# Chat style'));
  });

  it('keeps the task-agent prompt for non-IM turns', () => {
    const task = ids(httpTurn);
    expect(task).toContain('§5b_editing');
    expect(task.indexOf('§11_bootstrap')).toBeGreaterThan(task.indexOf('§5b_editing'));
    const prompt = buildRichSystemPrompt({ ...base, turn: httpTurn });
    expect(prompt).toContain('<workflow>');
    expect(prompt).not.toContain('Keep response under 4 lines');
    expect(prompt).toContain('match reply length to question complexity');
  });

  it('loads first-person SOUL prose without deriving account identity from it', () => {
    const soul = '## SOUL.md\n\n我是一个喜欢聊天和音乐的人。';
    expect(buildRichSystemPrompt({ ...base, bootstrapContext: soul, turn: imTurn, agentNickname: '小凉' }))
      .toContain('我是一个喜欢聊天和音乐的人。');
  });

  it('keeps explicit capability nickname templates separate from SOUL prose', () => {
    expect(fillPromptSlots('Hello {{nickname}}', undefined)).toBe('Hello Zhin');
    expect(fillPromptSlots('{{nick}}', '小凉')).toBe('{{nick}}');
  });
});
