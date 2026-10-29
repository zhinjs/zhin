import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  EMPTY_TOKEN_USAGE,
  createLlmMessageProjection,
  createMemberChangedEvent,
  createMemberPresenceEvent,
  createUserMessage,
  formatHeader,
  renderEventsForProvider,
  repairAgentMessagesForLlm,
  type AgentMessage,
  type AssistantMessage,
  type ToolResultMessage,
  type UserMessage,
} from '../../src/index.js';
import { agentMessagesToAiSdk } from '../../src/llm/bridge/ai-sdk-messages.js';

const T = (h: number, m = 0, s = 0, ms = 0) => new Date(2026, 9, 29, h, m, s, ms).getTime();

function member(text: string, userId: string, at: number, id = `m${at}`): UserMessage {
  return {
    ...createUserMessage(`${formatHeader([['id', id], ['user_id', userId], ['time', '09:00:00.000']])}\n${text}`, undefined, at),
  };
}

function assistantCalling(ids: string[], at: number): AssistantMessage {
  return {
    role: 'assistant',
    content: ids.map(id => ({ type: 'toolCall' as const, id, name: 'lookup', arguments: {} })),
    api: 'ai-sdk', provider: 'p', model: 'm', usage: EMPTY_TOKEN_USAGE, stopReason: 'toolCalls', timestamp: at,
  };
}

function assistantText(text: string, at: number): AssistantMessage {
  return {
    role: 'assistant', content: [{ type: 'text', text }],
    api: 'ai-sdk', provider: 'p', model: 'm', usage: EMPTY_TOKEN_USAGE, stopReason: 'stop', timestamp: at,
  };
}

function toolResult(id: string, at: number): ToolResultMessage {
  return { role: 'toolResult', toolCallId: id, toolName: 'lookup', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: at };
}

const join = (at = T(9, 1)) => createMemberPresenceEvent({ timestamp: at, id: 'ev-join' }, { action: 'join', userId: '10002', sceneId: '123' });
const roleChange = (at = T(9, 2)) => createMemberChangedEvent({ timestamp: at, id: 'ev-role' }, { operatorId: '10001', userId: '10002', field: 'role', value: 'admin' });

/** What the OpenAI chat API enforces: every tool_call answered by its tool messages before any other message. */
function expectValidOpenAiShape(messages: ModelMessage[]): void {
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]!;
    if (message.role === 'tool') {
      const previous = messages.slice(0, i).reverse().find(candidate => candidate.role !== 'tool');
      expect(previous?.role).toBe('assistant');
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const callIds = message.content.flatMap(part => (part.type === 'tool-call' ? [part.toolCallId] : []));
      if (callIds.length === 0) continue;
      const answered = new Set<string>();
      let j = i + 1;
      while (j < messages.length && messages[j]!.role === 'tool') {
        for (const part of messages[j]!.content as Array<{ toolCallId: string }>) answered.add(part.toolCallId);
        j += 1;
      }
      expect([...answered].sort()).toEqual([...callIds].sort());
    }
  }
}

describe('renderEventsForProvider', () => {
  const history = (): AgentMessage[] => [member('hello', '10002', T(9, 0)), assistantText('hi', T(9, 0, 1)), join(), roleChange(), member('thanks', '10002', T(9, 3))];

  it('returns the same array when there are no events', () => {
    const plain = [member('a', '1', 1)];
    expect(renderEventsForProvider(plain, 'system')).toBe(plain);
  });

  it('system: consecutive events become one system message at that position', () => {
    const out = renderEventsForProvider(history(), 'system');
    expect(out.map(m => m.role)).toEqual(['user', 'assistant', 'system', 'user']);
    expect((out[2] as { content: string }).content).toBe([
      '[state change] 10002 join 123 on 09:01:00.000 by self',
      '[state change] 10001 changed 10002 role to "admin"',
    ].join('\n'));
  });

  it('developer: a developer message', () => {
    const out = renderEventsForProvider(history(), 'developer');
    expect(out[2]!.role).toBe('developer');
    expect((out[2] as { content: string }).content.startsWith('[state change]')).toBe(true);
  });

  it('none: a user_id:system user message between non-user neighbours', () => {
    const messages = [assistantText('hi', 1), join(T(9, 1)), assistantText('later', T(9, 2))];
    const out = renderEventsForProvider(messages, 'none');
    expect(out.map(m => m.role)).toEqual(['assistant', 'user', 'assistant']);
    const text = ((out[1] as UserMessage).content[0] as { text: string }).text;
    expect(text).toBe('[id:ev-join;user_id:system;time:09:01:00.000;]\n[state change] 10002 join 123 on 09:01:00.000 by self');
  });

  it('none: merges into the adjacent user message, keeping each part header (never under the member)', () => {
    const out = renderEventsForProvider(history(), 'none');
    // user, assistant, [event-user], user -> event merges into the following member message
    expect(out.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    const blocks = (out[2] as UserMessage).content.map(block => (block as { text: string }).text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.startsWith('[id:ev-join;user_id:system;')).toBe(true);
    expect(blocks[1]!.startsWith('[id:m')).toBe(true);
    expect(blocks[1]).toContain('user_id:10002');
    expect(blocks[1]).not.toContain('user_id:system');
  });

  it('none: merges into the previous user message when one precedes it', () => {
    const out = renderEventsForProvider([member('hello', '10002', T(9, 0)), join()], 'none');
    expect(out).toHaveLength(1);
    const blocks = (out[0] as UserMessage).content.map(block => (block as { text: string }).text);
    expect(blocks[0]).toContain('user_id:10002');
    expect(blocks[1]).toContain('user_id:system');
  });

  it('a member whose id is system keeps the user:system label, distinct from host events', () => {
    const impostor = {
      ...createUserMessage(`${formatHeader([['id', 'x'], ['user_id', 'user:system']])}\nhi`, undefined, 1),
    };
    const out = renderEventsForProvider([impostor, join()], 'none');
    const blocks = (out[0] as UserMessage).content.map(block => (block as { text: string }).text);
    expect(blocks[0]).toContain('user_id:user:system');
    expect(blocks[1]).toContain('user_id:system;');
  });

  it('never splits an assistant tool_calls message from its tool results', () => {
    const messages: AgentMessage[] = [
      member('look it up', '10002', T(9, 0)),
      assistantCalling(['a', 'b'], T(9, 0, 1)),
      toolResult('a', T(9, 0, 2)),
      join(T(9, 0, 3)),
      toolResult('b', T(9, 0, 4)),
      assistantText('done', T(9, 0, 5)),
    ];
    for (const capability of ['system', 'developer', 'none'] as const) {
      const out = renderEventsForProvider(messages, capability);
      expect(out.map(m => m.role)).toEqual(
        capability === 'none'
          ? ['user', 'assistant', 'toolResult', 'toolResult', 'user', 'assistant']
          : ['user', 'assistant', 'toolResult', 'toolResult', capability, 'assistant'],
      );
      expectValidOpenAiShape(agentMessagesToAiSdk(repairAgentMessagesForLlm(out), undefined, { preRepaired: true }));
    }
  });

  it('keeps events arriving mid-group through repair and places them after the group', () => {
    const messages: AgentMessage[] = [
      member('go', '1', T(9, 0)),
      assistantCalling(['a'], T(9, 0, 1)),
      join(T(9, 0, 2)),
      toolResult('a', T(9, 0, 3)),
    ];
    const repaired = repairAgentMessagesForLlm(messages);
    expect(repaired.map(m => m.role)).toEqual(['user', 'assistant', 'toolResult', 'event']);
    expectValidOpenAiShape(agentMessagesToAiSdk(renderEventsForProvider(repaired, 'system'), undefined, { preRepaired: true }));
  });

  it('trailing events after a finished group are appended last', () => {
    const out = renderEventsForProvider([member('a', '1', 1), assistantText('b', 2), join(3)], 'system');
    expect(out.map(m => m.role)).toEqual(['user', 'assistant', 'system']);
  });

  it('is append-only: a late event is not moved before earlier messages, and earlier output is a stable prefix', () => {
    const base: AgentMessage[] = [member('a', '1', T(9, 0)), assistantText('b', T(9, 0, 1)), member('c', '1', T(9, 5))];
    // the event's own timestamp is older than the last message, but it arrived (was stored) after it
    const late = join(T(9, 1));
    const before = renderEventsForProvider(base, 'system');
    const after = renderEventsForProvider([...base, late], 'system');
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)!.role).toBe('system');
  });

  it('does not mutate the stored history', () => {
    const stored = history();
    const snapshot = JSON.stringify(stored);
    renderEventsForProvider(stored, 'none');
    expect(JSON.stringify(stored)).toBe(snapshot);
  });
});

describe('request shapes at the bridge', () => {
  it('OpenAI-shaped: the state change is a system message; no name field anywhere', () => {
    const project = createLlmMessageProjection({ sdk: 'openai', id: 'gpt-4o' });
    const wire = agentMessagesToAiSdk(project([member('hello', '10002', T(9, 0)), assistantText('hi', T(9, 0, 1)), join(), member('yo', '10002', T(9, 3))]), undefined, { preRepaired: true, sdk: 'openai' });
    expect(wire.map(m => m.role)).toEqual(['user', 'assistant', 'system', 'user']);
    expect(wire[2]).toEqual({ role: 'system', content: '[state change] 10002 join 123 on 09:01:00.000 by self' });
    expect(JSON.stringify(wire)).not.toContain('"name"');
  });

  it('Anthropic-shaped: no system role; the state change is a user_id:system user message', () => {
    const project = createLlmMessageProjection({ sdk: 'anthropic', id: 'claude' });
    const wire = agentMessagesToAiSdk(project([member('hello', '10002', T(9, 0)), assistantText('hi', T(9, 0, 1)), join(), assistantText('x', T(9, 4))]), undefined, { preRepaired: true, sdk: 'anthropic' });
    expect(wire.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const text = JSON.stringify(wire[2]);
    expect(text).toContain('user_id:system');
    expect(text).toContain('[state change] 10002 join 123');
  });

  it('a stray system message never reaches an Anthropic or Gemini request', () => {
    for (const sdk of ['anthropic', 'google'] as const) {
      const wire = agentMessagesToAiSdk([member('a', '1', 1), { role: 'system', content: 'x', timestamp: 2 } as AgentMessage], undefined, { preRepaired: true, sdk });
      expect(wire.map(m => m.role)).toEqual(['user']);
    }
  });
});
