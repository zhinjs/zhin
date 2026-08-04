/**
 * Agent stream reducer + NDJSON consumer 测试
 *
 * 覆盖：
 * - reduceAgentStreamEvent 的 waiting 在新活动/失败/完成时复位
 * - NDJSON 消费端对多字节字符跨 chunk 的流式解码（不产生 U+FFFD）
 * - 损坏行兜底跳过、末尾残行 flush
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_RUN_EVENT_VERSION,
  AgentRunJournal,
  AgentStreamEventType,
  createAgentStreamReduceState,
  reduceAgentStreamEvent,
} from '../src/agent-stream.js';
import { iterateAgentStreamNdjson } from '../src/agent-stream-consumer.js';

describe('reduceAgentStreamEvent waiting 复位', () => {
  function waitingState() {
    return reduceAgentStreamEvent(createAgentStreamReduceState(), {
      type: AgentStreamEventType.SESSION_WAITING,
    });
  }

  it('SESSION_WAITING 置 waiting=true', () => {
    expect(waitingState().waiting).toBe(true);
  });

  it('TURN_STARTED 复位 waiting', () => {
    const next = reduceAgentStreamEvent(waitingState(), { type: AgentStreamEventType.TURN_STARTED });
    expect(next.waiting).toBe(false);
  });

  it('SESSION_STARTED 复位 waiting', () => {
    const next = reduceAgentStreamEvent(waitingState(), { type: AgentStreamEventType.SESSION_STARTED });
    expect(next.waiting).toBe(false);
  });

  it('MESSAGE_APPENDED 复位 waiting', () => {
    const next = reduceAgentStreamEvent(waitingState(), {
      type: AgentStreamEventType.MESSAGE_APPENDED,
      data: { messageDelta: 'hi' },
    });
    expect(next.waiting).toBe(false);
  });

  it('SESSION_COMPLETED / TURN_COMPLETED 复位 waiting', () => {
    expect(
      reduceAgentStreamEvent(waitingState(), { type: AgentStreamEventType.SESSION_COMPLETED }).waiting,
    ).toBe(false);
    expect(
      reduceAgentStreamEvent(waitingState(), { type: AgentStreamEventType.TURN_COMPLETED }).waiting,
    ).toBe(false);
  });

  it('SESSION_FAILED 复位 waiting 且置 failed', () => {
    const next = reduceAgentStreamEvent(waitingState(), { type: AgentStreamEventType.SESSION_FAILED });
    expect(next.waiting).toBe(false);
    expect(next.failed).toBe(true);
  });

  it('TURN_FAILED 复位 waiting 且置 failed', () => {
    const next = reduceAgentStreamEvent(waitingState(), { type: AgentStreamEventType.TURN_FAILED });
    expect(next.waiting).toBe(false);
    expect(next.failed).toBe(true);
  });

  it('TURN_CANCELLED 复位 waiting 且保留非失败终态', () => {
    const next = reduceAgentStreamEvent(waitingState(), {
      version: AGENT_RUN_EVENT_VERSION,
      type: AgentStreamEventType.TURN_CANCELLED,
      run: { sessionId: 's1', turnId: 't1' },
      terminal: 'cancelled',
    });
    expect(next.waiting).toBe(false);
    expect(next.cancelled).toBe(true);
    expect(next.failed).toBe(false);
  });
});

describe('iterateAgentStreamNdjson', () => {
  it('多字节字符跨 chunk 时按流式解码，不产生 U+FFFD', async () => {
    const line =
      JSON.stringify({
        type: AgentStreamEventType.MESSAGE_APPENDED,
        data: { messageDelta: '你好世界' },
      }) + '\n';
    const bytes = new TextEncoder().encode(line);
    // 找一个字节切分点，保证切在「你」的多字节序列中间
    const prefix = new TextEncoder().encode('{"type":"message.appended","data":{"messageDelta":"');
    const splitAt = prefix.length + 1; // 「你」3 字节，切在第 1 字节后
    const chunks = [bytes.slice(0, splitAt), bytes.slice(splitAt)];

    async function* body() {
      for (const c of chunks) yield c;
    }

    const events = [];
    for await (const event of iterateAgentStreamNdjson(body())) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0].data?.messageDelta).toBe('你好世界');
    expect(JSON.stringify(events[0])).not.toContain('�');
  });

  it('损坏行兜底跳过，不崩掉整个流', async () => {
    const good = JSON.stringify({ type: AgentStreamEventType.TURN_STARTED });
    const text = `not-json-at-all\n${good}\n`;
    async function* body() {
      yield new TextEncoder().encode(text);
    }
    const events = [];
    for await (const event of iterateAgentStreamNdjson(body())) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(AgentStreamEventType.TURN_STARTED);
  });

  it('末尾无换行的残行在 flush 时产出', async () => {
    const text = JSON.stringify({ type: AgentStreamEventType.SESSION_COMPLETED });
    async function* body() {
      yield new TextEncoder().encode(text);
    }
    const events = [];
    for await (const event of iterateAgentStreamNdjson(body())) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(AgentStreamEventType.SESSION_COMPLETED);
  });

  it('支持 ReadableStream body 的流式解码', async () => {
    const line = JSON.stringify({ type: AgentStreamEventType.TURN_STARTED }) + '\n';
    const bytes = new TextEncoder().encode(line);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 5));
        controller.enqueue(bytes.slice(5));
        controller.close();
      },
    });
    const events = [];
    for await (const event of iterateAgentStreamNdjson(stream)) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
  });
});

describe('AgentRunJournal', () => {
  it('appends an ordered run envelope and replays from a sequence cursor', () => {
    const journal = new AgentRunJournal({ sessionId: 's1', turnId: 't1' });
    const first = journal.append({ type: AgentStreamEventType.TURN_STARTED });
    const second = journal.append({ type: AgentStreamEventType.MESSAGE_APPENDED, data: { messageDelta: 'hi' } });

    expect(first).toMatchObject({ version: AGENT_RUN_EVENT_VERSION, run: { sessionId: 's1', turnId: 't1' }, sequence: 1 });
    expect(second).toMatchObject({ sequence: 2, type: AgentStreamEventType.MESSAGE_APPENDED });
    expect(journal.replay(1)).toEqual([second]);
  });

  it('accepts only the first terminal and suppresses all late events', () => {
    const journal = new AgentRunJournal({ sessionId: 's1', turnId: 't1' });
    const terminal = journal.append({ type: AgentStreamEventType.TURN_CANCELLED, terminal: 'cancelled' });

    expect(terminal).toMatchObject({ sequence: 1, terminal: 'cancelled' });
    expect(journal.append({ type: AgentStreamEventType.TURN_COMPLETED, terminal: 'completed' })).toBeUndefined();
    expect(journal.append({ type: AgentStreamEventType.MESSAGE_APPENDED })).toBeUndefined();
    expect(journal.replay()).toEqual([terminal]);
  });
});
