import { createUserMessage, estimateAgentMessagesTokens, projectPromptContext, type AgentMessage, type AssistantMessage, type ToolResultMessage } from '@zhin.js/ai';
import {
  DEFAULT_HISTORY_TOKENS, HistoryWindowTracker, historySceneFromTurn, parseHistoryTokenCount,
  resolveHistoryMaxMessages, resolveHistoryTokens,
} from '../../src/context/history-window.js';

let clock = 1_000;
const assistant = (content: AssistantMessage['content']): AssistantMessage => ({
  role: 'assistant', content, api: 'x', provider: 'p', model: 'm', timestamp: ++clock, stopReason: 'stop',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
} as AssistantMessage);
const user = (text: string) => createUserMessage(text, undefined, ++clock);
const words = (n: number) => 'word '.repeat(n);
const tokens = (messages: AgentMessage[]) => estimateAgentMessagesTokens(projectPromptContext(messages));
const firstText = (messages: AgentMessage[]) => (messages[0] as { content: Array<{ text: string }> }).content[0]!.text;

/** user, assistant(tool call), toolResult, assistant(text) */
function toolTurn(id: string, size: number): AgentMessage[] {
  return [
    user(`ask ${id} ${words(Math.min(size, 20))}`),
    assistant([{ type: 'toolCall', id, name: 'read', arguments: { path: id } }]),
    { role: 'toolResult', toolCallId: id, toolName: 'read', content: [{ type: 'text', text: words(size) }], isError: false, timestamp: ++clock } as ToolResultMessage,
    assistant([{ type: 'text', text: `done ${id}` }]),
  ];
}
const chatTurn = (id: string, size: number): AgentMessage[] => [user(`${id} ${words(size)}`), assistant([{ type: 'text', text: `re ${id}` }])];

describe('history token budget config (ADR 0043 §2)', () => {
  it('defaults per scene', () => {
    expect(DEFAULT_HISTORY_TOKENS).toEqual({ group: 8000, private: 12000, masterPrivate: 24000 });
    expect(resolveHistoryTokens(undefined, 'group')).toBe(8000);
    expect(resolveHistoryTokens(undefined, 'private')).toBe(12000);
    expect(resolveHistoryTokens(null, 'masterPrivate')).toBe(24000);
  });
  it('a number applies to every scene, an object overrides per scene', () => {
    expect(resolveHistoryTokens(5000, 'masterPrivate')).toBe(5000);
    expect(resolveHistoryTokens({ group: 2000 }, 'group')).toBe(2000);
    expect(resolveHistoryTokens({ group: 2000 }, 'private')).toBe(12000);
    expect(resolveHistoryTokens({ masterPrivate: '30k' }, 'masterPrivate')).toBe(30000);
  });
  it('parses strings and falls back on garbage; 0 disables the bound', () => {
    expect(parseHistoryTokenCount('8k')).toBe(8000);
    expect(parseHistoryTokenCount('1500')).toBe(1500);
    expect(parseHistoryTokenCount('lots')).toBeUndefined();
    expect(parseHistoryTokenCount(-5)).toBeUndefined();
    expect(resolveHistoryTokens('nope' as never, 'group')).toBe(8000);
    expect(resolveHistoryTokens(0, 'group')).toBe(0);
  });
  it('maxRecentMessages is an optional upper bound', () => {
    expect(resolveHistoryMaxMessages(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(resolveHistoryMaxMessages('40')).toBe(40);
    expect(resolveHistoryMaxMessages(0)).toBe(Number.POSITIVE_INFINITY);
  });
  it('scene comes from the turn view', () => {
    const turn = (scope: string, roles: string[], kind = 'im') => ({ origin: { kind, scope }, principal: { roles } });
    expect(historySceneFromTurn(turn('group', ['master']))).toBe('group');
    expect(historySceneFromTurn(turn('channel', []))).toBe('group');
    expect(historySceneFromTurn(turn('private', []))).toBe('private');
    expect(historySceneFromTurn(turn('private', ['master']))).toBe('masterPrivate');
    expect(historySceneFromTurn(undefined)).toBe('private');
  });
});

describe('HistoryWindowTracker', () => {
  const opts = (budget: number, maxMessages = Number.POSITIVE_INFINITY) => ({ budget, maxMessages });

  it('keeps everything while under budget', () => {
    const messages = [...chatTurn('a', 20), ...chatTurn('b', 20), user('now')];
    const out = new HistoryWindowTracker().select('s', messages, opts(8000));
    expect(out.messages).toBe(messages);
    expect(out.dropped).toBe(0);
  });

  it('fills newest to oldest within the budget and measures after projection', () => {
    const history = Array.from({ length: 12 }, (_, i) => chatTurn(`t${i}`, 100)).flat();
    const messages = [...history, user('now')];
    const out = new HistoryWindowTracker().select('s', messages, opts(600));
    expect(out.dropped).toBeGreaterThan(0);
    expect(tokens(out.messages.slice(0, -1))).toBeLessThanOrEqual(600);
    expect(out.messages.at(-1)).toBe(messages.at(-1));
    expect(out.messages.at(-2)).toBe(messages.at(-2));
  });

  it('never splits a turn: tool call and results stay together, start is a user message', () => {
    const history = Array.from({ length: 10 }, (_, i) => toolTurn(`c${i}`, 80)).flat();
    const messages = [...history, user('now')];
    for (const budget of [300, 500, 900, 1500]) {
      const out = new HistoryWindowTracker().select(`s${budget}`, messages, opts(budget));
      expect(out.messages[0]!.role).toBe('user');
      const ids = new Set<string>();
      for (const m of out.messages) {
        if (m.role === 'assistant') for (const b of m.content) if (b.type === 'toolCall') ids.add(b.id);
        if (m.role === 'toolResult') expect(ids.has(m.toolCallId)).toBe(true);
      }
    }
  });

  it('merged consecutive user messages enter or leave together', () => {
    const merged = [user(`m1 ${words(100)}`), user(`m2 ${words(100)}`), assistant([{ type: 'text', text: 'ok' }])];
    const messages = [...chatTurn('old', 300), ...merged, user('now')];
    const out = new HistoryWindowTracker().select('s', messages, opts(500));
    expect(firstText(out.messages).startsWith('m1')).toBe(true);
  });

  it('maxRecentMessages is an upper bound; whichever limit is hit first wins', () => {
    const messages = [...Array.from({ length: 10 }, (_, i) => chatTurn(`t${i}`, 2)).flat(), user('now')];
    const tight = new HistoryWindowTracker().select('s', messages, opts(100_000, 6));
    expect(tight.messages.length - 1).toBeLessThanOrEqual(6);
    const small = new HistoryWindowTracker().select('s2', messages, opts(60, 100));
    expect(small.dropped).toBeGreaterThan(0);
    const off = new HistoryWindowTracker().select('s3', messages, opts(0));
    expect(off.messages).toBe(messages);
  });

  it('keeps the summary head and a lone oversized current turn', () => {
    const summary = createUserMessage('[Previous conversation summary]\nearlier talk', undefined, 1);
    const messages = [summary, ...chatTurn('a', 400), user(`now ${words(5000)}`)];
    const out = new HistoryWindowTracker().select('s', messages, opts(300));
    expect(out.messages[0]).toBe(summary);
    expect(out.messages.at(-1)).toBe(messages.at(-1));
    expect(out.messages).toHaveLength(2);
  });

  it('does not move the start while under budget; moves in blocks once exceeded', () => {
    const tracker = new HistoryWindowTracker();
    const budget = 1200;
    const history: AgentMessage[] = [];
    const starts: string[] = [];
    for (let i = 0; i < 40; i++) {
      history.push(...chatTurn(`t${i}`, 60));
      const out = tracker.select('s', [...history, user('now')], opts(budget));
      starts.push(firstText(out.messages));
      expect(tokens(out.messages.slice(0, -1))).toBeLessThanOrEqual(budget);
    }
    const moves = starts.filter((s, i) => i > 0 && s !== starts[i - 1]).length;
    expect(moves).toBeGreaterThan(0);
    // a start that follows the budget turn by turn would move on every turn once it is full
    expect(moves).toBeLessThan(15);
    let run = 1;
    let longest = 1;
    for (let i = 1; i < starts.length; i++) { run = starts[i] === starts[i - 1] ? run + 1 : 1; longest = Math.max(longest, run); }
    expect(longest).toBeGreaterThanOrEqual(3);
  });

  it('after a move the window sits at or under 75% of the budget', () => {
    const tracker = new HistoryWindowTracker();
    const budget = 1000;
    const history: AgentMessage[] = [];
    let prev = -1;
    for (let i = 0; i < 30; i++) {
      history.push(...chatTurn(`t${i}`, 40));
      const out = tracker.select('s', [...history, user('now')], opts(budget));
      if (prev >= 0 && out.start !== prev) expect(tokens(out.messages.slice(0, -1))).toBeLessThanOrEqual(budget * 0.75);
      prev = out.start;
    }
  });

  it('is deterministic for the same history and session state', () => {
    const messages = [...Array.from({ length: 12 }, (_, i) => chatTurn(`t${i}`, 100)).flat(), user('now')];
    const a = new HistoryWindowTracker().select('s', messages, opts(700));
    const b = new HistoryWindowTracker().select('s', messages, opts(700));
    expect(a.start).toBe(b.start);
  });

  it('hands the dropped part on unchanged: input is never mutated and dropped counts what left', () => {
    const messages = [...Array.from({ length: 12 }, (_, i) => chatTurn(`t${i}`, 100)).flat(), user('now')];
    const snapshot = [...messages];
    const out = new HistoryWindowTracker().select('s', messages, opts(700));
    expect(messages).toEqual(snapshot);
    expect(out.dropped + out.messages.length).toBe(messages.length);
  });

  it('tool results of finished turns count trimmed against the budget', () => {
    const messages = [...toolTurn('a', 2000), ...chatTurn('b', 10), user('now')];
    const out = new HistoryWindowTracker().select('s', messages, opts(800));
    expect(out.dropped).toBe(0);
  });

  it('tracks a bounded number of sessions', () => {
    const tracker = new HistoryWindowTracker();
    const messages = [...chatTurn('a', 100), ...chatTurn('b', 100), user('now')];
    for (let i = 0; i < 2100; i++) tracker.select(`s${i}`, messages, opts(100));
    expect(tracker.size).toBeLessThanOrEqual(2000);
  });
});
