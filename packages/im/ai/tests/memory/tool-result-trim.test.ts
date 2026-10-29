import { projectPromptContext } from '../../src/memory/prompt-context.js';
import { trimFinishedToolResults, lastTurnStart, FINISHED_TOOL_RESULT_KEEP_CHARS } from '../../src/memory/tool-result-trim.js';
import { createUserMessage, type AgentMessage, type AssistantMessage, type ToolResultMessage } from '../../src/llm/types/agent-message.js';

const assistant = (content: AssistantMessage['content'], t: number): AssistantMessage => ({
  role: 'assistant', content, api: 'x', provider: 'p', model: 'm', timestamp: t, stopReason: 'stop',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
} as AssistantMessage);
const result = (id: string, text: string, isError = false, t = 2): ToolResultMessage => ({
  role: 'toolResult', toolCallId: id, toolName: 'read', content: [{ type: 'text', text }], isError, timestamp: t,
});
const call = (id: string, args: Record<string, unknown> = { path: 'a.txt' }) => ({ type: 'toolCall' as const, id, name: 'read', arguments: args });

function turn(id: string, text: string, isError = false, args?: Record<string, unknown>): AgentMessage[] {
  return [
    createUserMessage(`question ${id}`, undefined, 1),
    assistant([call(id, args)], 1),
    result(id, text, isError),
    assistant([{ type: 'text', text: `answer ${id}` }], 3),
  ];
}
const texts = (m: AgentMessage) => (m as ToolResultMessage).content.map(b => (b as { text: string }).text).join('');

describe('ADR 0043 §3 finished-turn tool result trimming', () => {
  const long = 'x'.repeat(1000);

  it('keeps the head and counts the omitted characters for finished turns', () => {
    const out = trimFinishedToolResults([...turn('a', long), ...turn('b', long)]);
    expect(texts(out[2]!)).toBe(`${'x'.repeat(FINISHED_TOOL_RESULT_KEEP_CHARS)}…(已省略 800 字)`);
  });

  it('leaves the current turn untouched', () => {
    const msgs = [...turn('a', long), createUserMessage('now', undefined, 9), assistant([call('c')], 9), result('c', long, false, 10)];
    const out = trimFinishedToolResults(msgs);
    expect(texts(out[2]!)).toContain('已省略');
    expect(texts(out[out.length - 1]!)).toBe(long);
  });

  it('does not trim a result the model has not answered yet (steering after the result)', () => {
    const msgs = [createUserMessage('q', undefined, 1), assistant([call('a')], 1), result('a', long), createUserMessage('steer', undefined, 5)];
    expect(texts(trimFinishedToolResults(msgs)[2]!)).toBe(long);
  });

  it('keeps short results, isError and non-text blocks as they are', () => {
    const short = 'y'.repeat(FINISHED_TOOL_RESULT_KEEP_CHARS);
    const msgs = [...turn('a', short), ...turn('b', `ERR_CODE_42 ${long}`, true), createUserMessage('now', undefined, 9)];
    const out = trimFinishedToolResults(msgs);
    expect(out[2]).toBe(msgs[2]);
    const err = out[6] as ToolResultMessage;
    expect(err.isError).toBe(true);
    expect(err.toolCallId).toBe('b');
    expect(texts(err).startsWith('ERR_CODE_42 ')).toBe(true);
    expect(texts(err)).toContain('已省略');
  });

  it('shortens long call arguments but keeps name, id and short values', () => {
    const msgs = [...turn('a', 'ok', false, { path: 'a.txt', content: 'z'.repeat(500) }), createUserMessage('now', undefined, 9)];
    const out = trimFinishedToolResults(msgs);
    const block = (out[1] as AssistantMessage).content[0] as unknown as { name: string; id: string; arguments: Record<string, string> };
    expect(block.name).toBe('read');
    expect(block.id).toBe('a');
    expect(block.arguments.path).toBe('a.txt');
    expect(block.arguments.content).toBe(`${'z'.repeat(200)}…(已省略 300 字)`);
  });

  it('is deterministic, append-only friendly and never edits its input', () => {
    const history = [...turn('a', long), ...turn('b', long)];
    const snapshot = JSON.stringify(history);
    const first = trimFinishedToolResults([...history, createUserMessage('c', undefined, 9)]);
    const second = trimFinishedToolResults([...history, createUserMessage('c', undefined, 9), assistant([call('d')], 9), result('d', long, false, 10)]);
    expect(JSON.stringify(first.slice(0, history.length))).toBe(JSON.stringify(second.slice(0, history.length)));
    expect(JSON.stringify(history)).toBe(snapshot);
    expect(trimFinishedToolResults(history)).toEqual(trimFinishedToolResults(history));
  });

  it('merged consecutive user messages form one turn', () => {
    const msgs = [createUserMessage('a', undefined, 1), createUserMessage('b', undefined, 2)];
    expect(lastTurnStart(msgs)).toBe(0);
  });

  it('is part of the model projection', () => {
    const out = projectPromptContext([...turn('a', long), createUserMessage('now', undefined, 9)]);
    expect(texts(out[2]!)).toContain('已省略 800 字');
  });
});
