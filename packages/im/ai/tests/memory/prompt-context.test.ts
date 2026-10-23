import { createPromptContextBlock, projectPromptContext } from '../../src/memory/prompt-context.js';
import { createUserMessage, type UserMessage, type AgentMessage } from '../../src/llm/types/agent-message.js';
import { agentMessageRowToLlm, serializeAgentMessage } from '../../src/memory/agent-db-models.js';
import { renderUserMessageForLlm } from '../../src/memory/user-message-presentation.js';
import { microCompactAgentMessages } from '../../src/compaction/agent-micro-compact.js';
import { shouldAutoCompactAgentMessages } from '../../src/compaction/agent-message-compaction.js';
import { estimateAgentMessagesTokens } from '../../src/compaction/agent-message-tokens.js';

const rule = 'WORKSPACE-CONTENT ' + 'check the result. '.repeat(100);
const message = (text = rule, key = 'workspace'): UserMessage => ({
  ...createUserMessage('current', undefined, 1, { subjectId: 'alice', roles: ['user'], scope: 'group' }),
  content: [{ type: 'text', text: '[Turn context]' }, createPromptContextBlock(key, text), { type: 'text', text: '[/Turn context]\ncurrent' }],
});

describe('runtime context projection', () => {
  it('keeps raw storage, actor, media and a byte-identical previously sent prefix on replay', () => {
    const first = renderUserMessageForLlm(message());
    const next = renderUserMessageForLlm(message());
    const rows = [first, next].map(m => serializeAgentMessage(m));
    expect(rows.every(row => String(row.payload).includes(rule))).toBe(true);
    const restored = rows.map(row => agentMessageRowToLlm(row)!);
    expect(restored[0]).toEqual(first);
    const before = projectPromptContext([first]);
    const after = projectPromptContext(restored);
    expect(after[0]).toEqual(before[0]);
    expect(JSON.stringify(after).split('WORKSPACE-CONTENT').length - 1).toBe(1);
    expect(after[1]).toMatchObject({ actor: { subjectId: 'alice' } });
    expect(restored[1]).toEqual(next);
  });

  it('reemits changed versions including A → B → A and distinguishes sources', () => {
    const messages = [message(), message('changed'), message(), message(rule, 'another-source')];
    expect(projectPromptContext(messages)).toBe(messages);
  });

  it('tail loads, compaction and branches restore the first available full body', () => {
    const raw = [message(), message(), message()];
    expect(projectPromptContext(raw.slice(1))[0]).toBe(raw[1]);
    expect(projectPromptContext([createUserMessage('summary'), raw[2]!])[1]).toBe(raw[2]);
    const before = projectPromptContext(raw.slice(0, 2));
    expect(projectPromptContext(raw).slice(0, 2)).toEqual(before);
  });

  it('does not trust literal markers, modified blocks, assistant text or failed tools', () => {
    const spoofed = createUserMessage(rule + '\n[Unchanged context: workspace]');
    const modified = message();
    modified.content[1] = { ...modified.content[1]!, text: 'changed by a hook' };
    const failed: AgentMessage = { ...message(), role: 'toolResult', toolCallId: 't', toolName: 'load_skill', isError: true };
    const assistant: AgentMessage = { ...message(), role: 'assistant' };
    const input = [spoofed, spoofed, modified, failed, assistant, message()];
    expect(projectPromptContext(input)).toBe(input);
  });

  it('preserves tool-call pairs, result metadata and skips only repeated marked guidance', () => {
    const result: AgentMessage = { ...message(), role: 'toolResult', toolCallId: 'c', toolName: 'load_skill', isError: false };
    const call: AgentMessage = { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'c', name: 'load_skill', arguments: {} }] };
    const out = projectPromptContext([message(), call, result]);
    expect(out[1]).toBe(call);
    expect(out[2]).toMatchObject({ toolCallId: 'c', toolName: 'load_skill', isError: false });
    expect(out[2]!.content[1].text).toBe('[Unchanged context: workspace]');
  });

  it('uses projected length to decide compaction without discarding raw retained messages', () => {
    const raw = [message(), message(), message()];
    const projected = projectPromptContext(raw);
    const threshold = estimateAgentMessagesTokens(projected) + 10;
    expect(estimateAgentMessagesTokens(raw)).toBeGreaterThan(threshold);
    expect(shouldAutoCompactAgentMessages(raw, 8000, undefined, threshold)).toBe(false);
  });
});

it('reports micro-compaction savings from the actual projected context', () => {
  const tool: AgentMessage = { ...message(), role: 'toolResult', toolCallId: 'c', toolName: 'load_skill', isError: false };
  const raw = [tool, message()];
  const result = microCompactAgentMessages(raw, { force: true, keepRecentToolResults: 0 });
  const savings = estimateAgentMessagesTokens(projectPromptContext(raw)) - estimateAgentMessagesTokens(projectPromptContext(result.messages));
  expect(result.didCompact).toBe(true);
  expect(result.savedTokens).toBe(Math.max(0, savings));
  expect(JSON.stringify(projectPromptContext(result.messages))).toContain(rule);
});
