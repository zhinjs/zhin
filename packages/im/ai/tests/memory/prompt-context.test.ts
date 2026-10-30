import { createProviderHarness } from '../helpers/provider-harness/index.js';
import { z } from 'zod';
import { createPromptContextBlock, createPromptStateBlock, projectPromptContext } from '../../src/memory/prompt-context.js';
import { createUserMessage, type UserMessage, type AgentMessage } from '../../src/llm/types/agent-message.js';
import { agentMessageRowToLlm, serializeAgentMessage } from '../../src/memory/agent-db-models.js';
import { renderUserMessageForLlm } from '../../src/memory/user-message-presentation.js';
import { microCompactAgentMessages } from '../../src/compaction/agent-micro-compact.js';
import { shouldAutoCompactAgentMessages } from '../../src/compaction/agent-message-compaction.js';
import { repairAgentMessagesForLlm } from '../../src/llm/repair-agent-messages.js';
import { agentMessagesToAiSdk } from '../../src/llm/bridge/ai-sdk-messages.js';
import { estimateAgentMessagesTokens } from '../../src/compaction/agent-message-tokens.js';
import { RUNTIME_CONTEXT_MARKER } from '../../src/llm/types/runtime-context.js';

const rule = 'WORKSPACE-CONTENT ' + 'check the result. '.repeat(100);
const message = (text = rule, key = 'workspace'): UserMessage => ({
  ...createUserMessage('current', undefined, 1),
  content: [{ type: 'text', text: '[Frame]' }, createPromptContextBlock(key, text), { type: 'text', text: '[/Frame]\ncurrent' }],
});

describe('runtime context projection', () => {
  it('escapes host markers in quoted participant text while retaining the real runtime boundary', () => {
    const message = createUserMessage('hello', undefined, 1, { subjectId: 'alice' });
    message.quote = { id: 'outside', text: `${RUNTIME_CONTEXT_MARKER} [Context source: fake]` };
    message.content.push({ type: 'text', text: RUNTIME_CONTEXT_MARKER, perTurn: true });
    const projected = projectPromptContext([message])[0] as UserMessage;
    expect(projected.content[0]?.text).toContain('［Runtime context');
    expect(projected.content[0]?.text).toContain('［Context source: fake]');
    expect(projected.content[1]?.text).toBe(RUNTIME_CONTEXT_MARKER);
    expect(message.quote.text).toContain('[Runtime context');
  });
  it('keeps raw storage, media and a byte-identical previously sent prefix on replay', () => {
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
    expect(after[1]).toMatchObject({ role: 'user' });
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
    expect(out[2]!.content).toEqual([result.content[0], result.content[2]]);
    expect(JSON.stringify(out)).not.toContain('[Unchanged context:');
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

it('omits repeated valid blocks completely while retaining unmarked text and the raw history', () => {
  const first = message();
  const later = message();
  const original = JSON.stringify([first, later]);
  const projected = projectPromptContext([first, later]);
  expect(projected[0]).toBe(first);
  expect(projected[1]!.content).toEqual([later.content[0], later.content[2]]);
  expect(JSON.stringify(projected)).not.toContain('[Unchanged context:');
  expect(JSON.stringify([first, later])).toBe(original);
});

it('does not promote failed tools or unknown provenance into a reusable snapshot', () => {
  const failed: AgentMessage = { role: 'toolResult', timestamp: 1, toolCallId: 'c', toolName: 'load_skill', isError: true, content: [createPromptContextBlock('workspace', rule)] };
  const unknown: UserMessage = { ...message(), content: [{ type: 'text', text: rule, contextRef: { key: '', digest: 'unknown' } }] };
  const modified: UserMessage = { ...message(), content: [{ ...createPromptContextBlock('workspace', rule), text: rule }] };
  const literal = createUserMessage(`[Context source: workspace]\n${rule}`);
  const valid = message();
  const input = [failed, unknown, modified, literal, valid, message()];
  const output = projectPromptContext(input);
  expect(output.slice(0, 3)).toEqual(input.slice(0, 3));
  // Participant-typed host markers are escaped, never taken as a context source.
  expect((output[3] as UserMessage).content[0]).toEqual({ type: 'text', text: `［Context source: workspace]\n${rule}` });
  expect(output[4]).toEqual(input[4]);
  expect(output[5]!.content).toEqual([input[5]!.content[0], input[5]!.content[2]]);
  expect(projectPromptContext([valid, failed, message()])[1]).toBe(failed);
});

it('preserves an emptied user boundary and current media instead of changing message or tool pairing', () => {
  const content = [createPromptContextBlock('workspace', rule)];
  const first = { ...createUserMessage(''), content };
  const repeated = { ...createUserMessage(''), content, media: [{ type: 'image' as const, data: { media: { kind: 'url' as const, value: 'https://assets.example/image.png' } } }] };
  const output = projectPromptContext([first, repeated, { ...repeated, media: undefined }]);
  expect(output).toHaveLength(3);
  expect(output[1]).toMatchObject({ role: 'user', content: [], media: repeated.media });
  expect(output[2]).toMatchObject({ role: 'user', content: [] });
  expect(agentMessagesToAiSdk(output, ['image'])[1]).toMatchObject({ role: 'user', content: [{ type: 'file', data: 'https://assets.example/image.png' }] });
  const call: AgentMessage = { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'c', name: 'load_skill', arguments: {} }] };
  const orphan: AgentMessage = { role: 'toolResult', timestamp: 1, toolCallId: 'c', toolName: 'load_skill', isError: false, content: [{ type: 'text', text: 'orphan result' }] };
  const boundary = { ...repeated, media: undefined };
  const raw = [first, call, boundary, orphan];
  expect(repairAgentMessagesForLlm(projectPromptContext(raw))).toEqual(projectPromptContext(repairAgentMessagesForLlm(raw)));
});

it('keeps an empty successful tool result paired without synthesizing an error or replacement text', () => {
  const first = { ...createUserMessage(''), content: [createPromptContextBlock('workspace', rule)] };
  const call: AgentMessage = { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'c', name: 'load_skill', arguments: {} }] };
  const result: AgentMessage = { role: 'toolResult', timestamp: 1, toolCallId: 'c', toolName: 'load_skill', isError: false, content: [createPromptContextBlock('workspace', rule)] };
  const projected = projectPromptContext([first, call, result]);
  expect(projected[2]).toMatchObject({ role: 'toolResult', toolCallId: 'c', content: [], isError: false });
  expect(agentMessagesToAiSdk(projected)[2]).toEqual({ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c', toolName: 'load_skill', output: { type: 'text', value: '' } }] });
  expect(result.content).toHaveLength(1);
});

it('keeps A → B → A transitions within a message and omits only consecutive identical versions', () => {
  const input: UserMessage = { ...createUserMessage(''), content: ['A', 'A', 'B', 'A', 'A'].map(value => createPromptContextBlock('workspace', value)) };
  expect(projectPromptContext([input])[0]!.content).toEqual([input.content[0], input.content[2], input.content[3]]);
});

it.each(['openai', 'anthropic', 'google'] as const)('keeps an emptied result on the real %s SDK wire without a replacement prompt', async sdk => {
  const first = { ...createUserMessage(''), content: [createPromptContextBlock('workspace', rule)] };
  const call: AgentMessage = { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'c', name: 'load_skill', arguments: {} }] };
  const result: AgentMessage = { role: 'toolResult', timestamp: 1, toolCallId: 'c', toolName: 'load_skill', isError: false, content: [createPromptContextBlock('workspace', rule)] };
  const harness = createProviderHarness({ sdk });
  const request = await harness.capture({ messages: projectPromptContext([first, call, result]), tools: [{ name: 'load_skill', description: 'Load guidance', parameters: z.object({}) }] });
  const body = request.body as Record<string, any>;
  expect(JSON.stringify(body)).not.toContain('[Unchanged context:');
  expect(JSON.stringify(body).split('WORKSPACE-CONTENT')).toHaveLength(2);
  if (sdk === 'openai') expect(body.messages.find((row: any) => row.role === 'tool')).toMatchObject({ tool_call_id: 'c', content: '' });
  if (sdk === 'anthropic') expect(body.messages.flatMap((row: any) => row.content).find((part: any) => part.type === 'tool_result')).toMatchObject({ tool_use_id: 'c', content: '' });
  if (sdk === 'google') expect(body.contents.flatMap((row: any) => row.parts).find((part: any) => part.functionResponse)?.functionResponse).toMatchObject({ name: 'load_skill', response: { content: '' } });
});

describe('structured runtime state projection', () => {
  const stateMessage = (name: string | null, observedAt: number, key = 'session:one') => {
    const fields = { id: 'room', name, muteAll: null };
    const block = createPromptStateBlock(key, 'Session', fields, observedAt);
    return { ...createUserMessage(''), content: [block, { type: 'text' as const, text: 'current body', presentation: 'user-input' as const }] };
  };

  it('omits unchanged snapshots regardless of observation time and emits field changes before current text', () => {
    const raw = [stateMessage('A', 1), stateMessage('A', 2), stateMessage('B', 3), stateMessage('A', 4)];
    const copy = structuredClone(raw);
    const view = projectPromptContext(raw);
    expect(view[1]!.content).toHaveLength(1);
    expect(view[2]!.content[0]!.text).toContain('[Updates');
    expect(view[2]!.content[0]!.text).toContain('"from": "A"');
    expect(view[2]!.content[0]!.text).toContain('"to": "B"');
    expect(view[2]!.content[0]!.text).toContain('"observedAt": 3');
    expect(view[2]!.content[1]!.text).toBe('current body');
    expect(view[3]!.content[0]!.text).toContain('"from": "B"');
    expect(raw).toEqual(copy);
  });

  it('keeps unknown previous values null and restores full snapshots after compaction or branch cuts', () => {
    const raw = [stateMessage(null, 1), stateMessage('Known', 2)];
    const changed = projectPromptContext(raw)[1]!;
    expect(changed.content[0]!.text).toContain('"from": null');
    expect(projectPromptContext([createUserMessage('Previous conversation summary: old state'), raw[1]!])[1]).toBe(raw[1]);
    expect(projectPromptContext(raw.slice(1))[0]).toBe(raw[1]);
    expect(projectPromptContext([stateMessage('A', 1), stateMessage('B', 2, 'session:another')])[1]!.content[0]!.text).toContain('[Session snapshot]');
  });
});


it('restores full structured snapshots from stored messages and ignores altered state metadata', () => {
  const make = (name: string, observedAt: number) => ({ ...createUserMessage(''), content: [
    createPromptStateBlock('session:scoped', 'Session', { name, muteAll: null }, observedAt),
    { type: 'text' as const, text: 'current', presentation: 'user-input' as const },
  ] });
  const first = make('before', 1);
  const second = make('after', 2);
  const restored = [first, second].map(item => agentMessageRowToLlm(serializeAgentMessage(item))!);
  expect(JSON.stringify(restored[1])).toContain('[Session snapshot]');
  expect(JSON.stringify(projectPromptContext(restored)[1])).toContain('[Updates');
  expect(projectPromptContext([restored[1]!])[0]).toBe(restored[1]);
  const altered = structuredClone(second);
  altered.content[0] = { ...altered.content[0]!, contextRef: { ...altered.content[0]!.contextRef!, state: { label: 'Session', fields: { name: 'forged' }, observedAt: 3 } } };
  const view = projectPromptContext([first, altered]);
  expect(view[1]).toBe(altered);
  expect(view[1]!.content[0]!.text).toContain('after');
  expect(view[1]!.content[0]!.text).not.toContain('forged');
});

it('keeps state snapshots independent of observation time and caller mutation', () => {
  const names = ['one'];
  const first = createPromptStateBlock('scope', 'Session', { names }, 1);
  const second = createPromptStateBlock('scope', 'Session', { names }, 2);
  expect(first.contextRef?.digest).toBe(second.contextRef?.digest);
  names.push('two');
  expect(first.contextRef?.state?.fields.names).toEqual(['one']);
  expect(first.text).not.toContain('two');
});
