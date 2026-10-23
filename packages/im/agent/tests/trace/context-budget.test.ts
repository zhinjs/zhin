import { createPromptContextBlock, projectPromptContext, estimateAgentMessagesTokens, createUserMessage } from '@zhin.js/ai';
import { describe, expect, it } from 'vitest';
import {
  TurnTraceCollector,
  buildContextBudgetReport,
  estimatePromptTokens,
  formatTurnTrace,
} from '../../src/trace/index.js';
import { renderDeferredToolIndex, renderSkillCatalog } from '../../src/skill/capability-catalog.js';

const skillCatalog = renderSkillCatalog([{ name: 'weekly-report', description: 'Write the weekly report.' }])!;
const bootstrap = `## SOUL.md\nBe kind.\n\n${skillCatalog}`;
const toolIndex = renderDeferredToolIndex([{ name: 'calendar_add', description: 'Add an event.' }])!;
const systemPrompt = `Rules.\n\n${bootstrap}\n\n${toolIndex}`;

function report() {
  return buildContextBudgetReport({
    systemPrompt,
    sections: [
      { id: '§1b_critical_rules', approxChars: 6, approxTokens: estimatePromptTokens('Rules.') },
      { id: '§11_bootstrap', approxChars: bootstrap.length, approxTokens: estimatePromptTokens(bootstrap) },
    ],
    bootstrapContext: bootstrap,
    activeSkillsContext: 'loaded skill body',
    loadedTools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: {} } } as never],
    deferredToolCount: 1,
    historyMessages: [createUserMessage('earlier question')],
    userMessages: [createUserMessage('你好 loaded skill body')],
  });
}

describe('buildContextBudgetReport', () => {
  it('estimates CJK at about one token per character', () => {
    expect(estimatePromptTokens('你好世界')).toBe(4);
    expect(estimatePromptTokens('abcdefgh')).toBe(2);
  });

  it('attributes catalogs out of bootstrap and the index out of the system prompt', () => {
    const budget = report();
    expect(budget.segments.skill_catalog).toBe(estimatePromptTokens(skillCatalog));
    expect(budget.segments.tool_index).toBe(estimatePromptTokens(toolIndex));
    expect(budget.segments.bootstrap).toBe(estimatePromptTokens(bootstrap) - budget.segments.skill_catalog);
    expect(budget.segments.active_skills).toBeGreaterThan(0);
    expect(budget.segments.history).toBeGreaterThan(0);
    expect(budget.tools).toEqual({ loaded: 1, deferred: 1 });
  });

  it('sums segments into total and fixed tokens without double counting', () => {
    const budget = report();
    const sum = Object.values(budget.segments).reduce((total, value) => total + value, 0);
    expect(budget.total_tokens).toBe(sum);
    const fixed = budget.segments.system + budget.segments.tool_schemas + budget.segments.tool_index
      + budget.segments.skill_catalog + budget.segments.agent_catalog + budget.segments.memory + budget.segments.bootstrap;
    expect(budget.fixed_tokens).toBe(fixed);
    expect(budget.sections[0]!.id).toBe('§11_bootstrap');
  });

  it('is kept once per trace and rendered by zhin trace', () => {
    const trace = new TurnTraceCollector({ turnId: 't1', sessionKey: 's1' });
    const first = report();
    trace.note({ kind: 'context_budget', report: first });
    trace.note({ kind: 'context_budget', report: { ...first, total_tokens: 1 } });
    const snapshot = trace.snapshot();
    expect(snapshot.context_budget?.total_tokens).toBe(first.total_tokens);
    const text = formatTurnTrace(snapshot, { timeline: false });
    expect(text).toContain(`上下文估算 ~${first.total_tokens} tokens`);
    expect(text).toContain('技能目录');
    expect(text).not.toContain('Write the weekly report');
  });
});

it('counts the output schema and projected instruction references without double counting the current catalog', () => {
  const injected = () => ({ ...createUserMessage('question'), content: [
    { type: 'text' as const, text: 'question' },
    createPromptContextBlock('skill:report', 'Skill body '.repeat(30)),
    createPromptContextBlock('deferred-tools', toolIndex),
  ] });
  const historyMessages = [injected()];
  const userMessages = [injected()];
  const outputSchema = { type: 'object', properties: { messages: { type: 'array' } } };
  const budget = buildContextBudgetReport({ systemPrompt: '', loadedTools: [], deferredToolCount: 1, historyMessages, userMessages, outputSchema });
  expect(budget.segments.output_schema).toBe(estimatePromptTokens(JSON.stringify(outputSchema)));
  expect(budget.total_tokens).toBe(estimateAgentMessagesTokens(projectPromptContext([...historyMessages, ...userMessages])) + budget.segments.output_schema);
  expect(budget.fixed_tokens).toBe(budget.segments.output_schema);
  expect(budget.segments.active_skills).toBeLessThan(estimatePromptTokens('Skill body '.repeat(30)));
});
