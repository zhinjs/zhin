import type { AgentMessage } from '@zhin.js/ai';
import { describe, expect, it } from 'vitest';
import {
  mergeMessageSegments,
  PromptSegmentMergeError,
  type MessageSegmentOutput,
} from '../../../src/prompt/segments/index.js';

const user = (timestamp: number, text: string): AgentMessage =>
  ({ role: 'user', content: [{ type: 'text', text }], timestamp }) as never;
const assistant = (timestamp: number, text: string): AgentMessage =>
  ({ role: 'assistant', content: [{ type: 'text', text }], timestamp }) as never;
const call = (timestamp: number, id: string): AgentMessage =>
  ({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'read', arguments: {} }], timestamp }) as never;
const calls = (timestamp: number, ...ids: string[]): AgentMessage =>
  ({ role: 'assistant', content: ids.map(id => ({ type: 'toolCall', id, name: 'read', arguments: {} })), timestamp }) as never;
const result = (timestamp: number, id: string): AgentMessage =>
  ({ role: 'toolResult', toolCallId: id, toolName: 'read', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp }) as never;
const event = (timestamp: number, name: string): AgentMessage =>
  ({ role: 'event', kind: 'member_joined', name, timestamp }) as never;
const out = (id: string, kind: MessageSegmentOutput['kind'], weight: number, ...messages: AgentMessage[]): MessageSegmentOutput =>
  ({ id, kind, weight, messages });
const label = (message: AgentMessage): string => {
  if (message.role === 'event') return `event:${(message as { name: string }).name}`;
  if (message.role === 'toolResult') return `result:${(message as { toolCallId: string }).toolCallId}`;
  const block = (message.content as Array<{ type: string; text?: string; id?: string }>)[0]!;
  return `${message.role}:${block.text ?? block.id}`;
};
const labels = (messages: readonly AgentMessage[]) => messages.map(label);

describe('mergeMessageSegments', () => {
  it('merges chronologically and keeps each segment in its own order', () => {
    const merged = mergeMessageSegments([
      out('u', 'user', 0, user(1, 'u1'), user(5, 'u2')),
      out('a', 'assistant', 0, assistant(3, 'a1'), assistant(7, 'a2')),
    ]);
    expect(labels(merged)).toEqual(['user:u1', 'assistant:a1', 'user:u2', 'assistant:a2']);
  });

  it('breaks timestamp ties state → user → tool → assistant, then by weight', () => {
    const merged = mergeMessageSegments([
      out('assistant', 'assistant', 0, assistant(10, 'A')),
      out('tool', 'tool', 0, call(10, 'c1'), result(10, 'c1')),
      out('user-low', 'user', 1, user(10, 'U-low')),
      out('user-high', 'user', 9, user(10, 'U-high')),
      out('state', 'state', 0, event(10, 'S')),
    ]);
    expect(labels(merged)).toEqual(['event:S', 'user:U-high', 'user:U-low', 'assistant:c1', 'result:c1', 'assistant:A']);
  });

  it('never merges a result ahead of its call', () => {
    const merged = mergeMessageSegments([
      out('assistant', 'assistant', 0, call(10, 'c1')),
      out('tool', 'tool', 0, result(10, 'c1')),
    ]);
    expect(labels(merged)).toEqual(['assistant:c1', 'result:c1']);
  });

  it('rejects orphan tool results and orphan tool calls', () => {
    expect(() => mergeMessageSegments([out('tool', 'tool', 0, result(1, 'ghost'))]))
      .toThrow(PromptSegmentMergeError);
    expect(() => mergeMessageSegments([out('assistant', 'assistant', 0, call(1, 'lonely'))]))
      .toThrow(/Orphan tool call/);
    expect(() => mergeMessageSegments([out('tool', 'tool', 0, call(1, 'c'), result(2, 'c'), result(3, 'c'))]))
      .toThrow(/Duplicate/);
  });

  it('moves an event that lands inside a tool call group to after the last result', () => {
    const merged = mergeMessageSegments([
      out('tool', 'tool', 0, calls(10, 'c1', 'c2'), result(14, 'c1'), result(15, 'c2')),
      out('state', 'state', 0, event(12, 'joined-mid-call')),
      out('user', 'user', 0, user(20, 'later')),
    ]);
    expect(labels(merged)).toEqual(['assistant:c1', 'result:c1', 'result:c2', 'event:joined-mid-call', 'user:later']);
  });

  it('rejects a non-event message inside an unfinished tool call group', () => {
    expect(() => mergeMessageSegments([
      out('tool', 'tool', 0, call(10, 'c1'), result(14, 'c1')),
      out('user', 'user', 0, user(12, 'interrupt')),
    ])).toThrow(/interrupt an unfinished tool call group/);
  });

  it('is append-only after the sent prefix: late events are appended, not inserted', () => {
    const first = [user(1, 'u1'), assistant(2, 'a1'), user(5, 'u2')];
    const sent = mergeMessageSegments([
      out('u', 'user', 0, first[0]!, first[2]!),
      out('a', 'assistant', 0, first[1]!),
    ]);
    const late = event(3, 'late');
    const next = user(9, 'u3');
    const merged = mergeMessageSegments([
      out('u', 'user', 0, first[0]!, first[2]!, next),
      out('a', 'assistant', 0, first[1]!),
      out('s', 'state', 0, late),
    ], { sent });
    expect(merged.slice(0, sent.length)).toEqual(sent);
    expect(labels(merged)).toEqual(['user:u1', 'assistant:a1', 'user:u2', 'event:late', 'user:u3']);
    // Without the sent prefix the same inputs would insert the event mid-history.
    expect(labels(mergeMessageSegments([
      out('u', 'user', 0, first[0]!, first[2]!, next),
      out('a', 'assistant', 0, first[1]!),
      out('s', 'state', 0, late),
    ]))).toEqual(['user:u1', 'assistant:a1', 'event:late', 'user:u2', 'user:u3']);
  });

  it('keeps events behind an open tool group that was already sent', () => {
    const sent = mergeMessageSegments([out('tool', 'tool', 0, call(10, 'c1'), result(11, 'c1'))]).slice(0, 1);
    const merged = mergeMessageSegments([
      out('tool', 'tool', 0, call(10, 'c1'), result(20, 'c1')),
      out('state', 'state', 0, event(15, 'during')),
    ], { sent });
    expect(labels(merged)).toEqual(['assistant:c1', 'result:c1', 'event:during']);
  });
});
