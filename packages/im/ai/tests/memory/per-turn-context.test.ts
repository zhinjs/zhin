import { createPromptContextBlock, projectPromptContext } from '../../src/memory/prompt-context.js';
import { createUserMessage, type AgentMessage, type UserMessage } from '../../src/llm/types/agent-message.js';
import type { TextContentBlock } from '../../src/llm/types/content-block.js';
import { agentMessageRowToLlm, serializeAgentMessage } from '../../src/memory/agent-db-models.js';
import { normalizeUserMessageForStorage, userMessagePlainText } from '../../src/memory/user-message-presentation.js';
import { createLlmMessageProjection } from '../../src/memory/event-rendering.js';

const actor = { subjectId: 'alice', displayName: 'Alice', roles: ['user'], authorizationRoles: ['user'], scope: 'group' as const };
const model = { sdk: 'openai', id: 'm' } as never;

const TURN_CONTEXT = '[Turn context]\nGit: main | 2M\nReply language fallback: zh.\n[Tone hint] casual\n'
  + '[Already told the user]\n- said hi\nRelevant memory: likes tea\n[/Turn context]';

/** Per-turn blocks as ADR 0043 marks them at build time. */
function perTurnBlocks(): TextContentBlock[] {
  const mark = (block: TextContentBlock): TextContentBlock => ({ ...block, perTurn: true });
  return [
    mark(createPromptContextBlock('session-rules:abc', 'Session rules: unknown.')),
    mark(createPromptContextBlock('workspace-rules', '[Agents instructions] ' + 'rule. '.repeat(50))),
    mark(createPromptContextBlock('skill:report', 'Skill body '.repeat(30))),
    mark(createPromptContextBlock('deferred-tools', 'tool index '.repeat(40))),
    mark({ type: 'text', text: TURN_CONTEXT }),
  ];
}

function current(body: string, ts: number): UserMessage {
  return {
    ...createUserMessage(body, undefined, ts, actor),
    content: [...perTurnBlocks(), { type: 'text', text: body, presentation: 'user-input' }],
  };
}

/** A user message the way it was stored before ADR 0043: nothing marked, everything persisted. */
function legacy(body: string, ts: number): UserMessage {
  const unmarked = perTurnBlocks().map(({ perTurn: _p, ...block }) => block as TextContentBlock);
  return {
    ...createUserMessage(body, undefined, ts, actor),
    content: [...unmarked.slice(0, 4), unmarked[4]!, { type: 'text', text: body, presentation: 'user-input' }],
  };
}

const text = (message: AgentMessage) => userMessagePlainText(message as UserMessage);
const reply = (ts: number): AgentMessage => ({ role: 'assistant', timestamp: ts, content: [{ type: 'text', text: 'ok' }] } as AgentMessage);

describe('ADR 0043 §1 storage', () => {
  it('drops every per-turn block and keeps body and actor', () => {
    const { message } = normalizeUserMessageForStorage(current('hello there', 1));
    const stored = message as UserMessage;
    expect(stored.content).toEqual([{ type: 'text', text: 'hello there', presentation: 'user-input' }]);
    expect(stored.actor).toEqual(actor);
    const round = agentMessageRowToLlm(serializeAgentMessage(current('hello there', 1)))!;
    expect(JSON.stringify(round)).not.toMatch(/Turn context|workspace-rules|deferred-tools|skill:report|Already told/u);
  });

  it('keeps the quote relation as conversation', () => {
    const extra = { quote: { messageId: 'q1', block: '[Quoted message context - the user is replying to this]\nolder text' } };
    const row = serializeAgentMessage(current('reply', 1), extra);
    expect(String(row.extra)).toContain('older text');
    expect(String(row.payload)).not.toContain('workspace-rules');
  });
});

describe('ADR 0043 §1 legacy projection', () => {
  it('strips per-turn blocks from earlier user messages, keeps the current message whole', () => {
    const history = [legacy('first', 1), reply(2), legacy('second', 3), reply(4)];
    const cur = current('third', 5);
    const out = projectPromptContext([...history, cur]);
    for (const index of [0, 2]) {
      const old = out[index] as UserMessage;
      expect(old.content).toHaveLength(1);
      expect(text(old)).toMatch(/\[user_id:alice;.*\]\n(first|second)$/u);
      expect(text(old)).not.toMatch(/Turn context|Already told|Tone hint|Context source/u);
    }
    expect(out[0]).toMatchObject({ actor });
    const latest = out[4] as UserMessage;
    expect(latest.content.filter(block => block.contextRef).map(block => block.contextRef!.key))
      .toEqual(['session-rules:abc', 'workspace-rules', 'skill:report', 'deferred-tools']);
    expect(text(latest)).toContain('[Already told the user]');
    expect(text(latest)).toContain('third');
    expect(cur.content).toHaveLength(6); // input untouched
  });

  it('identifies legacy blocks by contextRef key and by text prefix, not by user words', () => {
    const keys = ['deferred-tools', 'workspace-rules', 'skill:x', 'file-memory:h', 'session-rules:h', 'active-skills',
      'deferred-catalog-summary', 'quote-guidance', 'session-guidance', 'session-identity'];
    const old: UserMessage = { ...createUserMessage('', undefined, 1, actor), content: [
      ...keys.map(key => createPromptContextBlock(key, 'x')),
      { type: 'text', text: '[Already told the user]\n- a' },
      { type: 'text', text: 'my words', presentation: 'user-input' },
    ] };
    const unrelated = createPromptContextBlock('custom-rule', 'kept');
    const out = projectPromptContext([{ ...old, content: [...old.content, unrelated] }, reply(2), legacy('now', 3)]);
    const stripped = out[0] as UserMessage;
    expect(stripped.content.map(block => block.type === 'text' ? block.text : '')).toEqual([expect.stringContaining('my words'), unrelated.text]);
  });

  it('strips an envelope glued in front of the user text in the oldest shape', () => {
    const glued = createUserMessage(`${TURN_CONTEXT}\n\nplain old question`, undefined, 1);
    const out = projectPromptContext([glued, reply(2), legacy('now', 3)]);
    expect(text(out[0]!)).toBe('plain old question');
  });

  it('leaves tool results and a user message that merely quotes the marker alone', () => {
    const skillResult: AgentMessage = { role: 'toolResult', timestamp: 2, toolCallId: 'c', toolName: 'load_skill', isError: false,
      content: [createPromptContextBlock('skill:report', 'Skill body')] };
    const spoof = createUserMessage('[Turn context] is a marker I typed', undefined, 1, actor);
    spoof.content = [{ type: 'text', text: '[Turn context] is a marker I typed', presentation: 'user-input' }];
    const out = projectPromptContext([spoof, skillResult, legacy('older', 3), reply(4), current('now', 5)]);
    expect(text(out[0]!)).toContain('is a marker I typed');
    expect(out[1]).toBe(skillResult);
  });

  it('body, actor, quote text and media of earlier messages are untouched', () => {
    const old = legacy('look at this', 1);
    const withMedia: UserMessage = { ...old, media: [{ type: 'image', data: { media: { kind: 'url', value: 'https://x/y.png' } } }] };
    const out = projectPromptContext([withMedia, reply(2), current('now', 3)]);
    expect((out[0] as UserMessage).media).toEqual(withMedia.media);
    expect(out[0]).toMatchObject({ actor, timestamp: 1 });
  });

  it('is a pure function of position: deterministic, append-only for older messages, no rewrite of input', () => {
    const history = [legacy('a', 1), reply(2), legacy('b', 3), reply(4)];
    const snapshot = JSON.stringify(history);
    const once = projectPromptContext([...history, current('c', 5)]);
    expect(projectPromptContext([...history, current('c', 5)])).toEqual(once);
    expect(JSON.stringify(history)).toBe(snapshot);
    // Next turn: the former current message becomes history and is stripped; everything before it is byte-identical.
    const next = projectPromptContext([...history, current('c', 5), reply(6), current('d', 7)]);
    expect(next.slice(0, 5 - 1)).toEqual(once.slice(0, 5 - 1));
    expect(next[4]!.content).toHaveLength(1);
    expect(JSON.stringify(next[4])).not.toContain('workspace-rules');
  });

  it('applies on the real LLM boundary and ignores a steering message after the current one', () => {
    const steer = createUserMessage('wait, also this', undefined, 8, actor);
    const llm = createLlmMessageProjection(model)([legacy('old', 1), reply(2), current('now', 3), reply(4), steer]);
    const users = llm.filter(message => message.role === 'user') as UserMessage[];
    expect(users).toHaveLength(3);
    expect(JSON.stringify(users[0])).not.toContain('workspace-rules');
    expect(JSON.stringify(users[1])).toContain('workspace-rules'); // current stays whole despite the later steer
  });

  it('keeps an emptied user boundary so indexes stay stable', () => {
    const onlyContext: UserMessage = { ...createUserMessage('', undefined, 1), content: perTurnBlocks() };
    const out = projectPromptContext([onlyContext, reply(2), legacy('now', 3)]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ role: 'user', content: [] });
  });
});
