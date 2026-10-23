import { describe, expect, it } from 'vitest';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { QqActiveMessageGate, QqPassiveReplyLedger, type QqReplySource } from '../src/passive-reply.js';
import { markdownAsText, sendQqMessages } from '../src/qq-send.js';

/** The SDK 1.3 rejection format the adapter reads platform codes from. */
const platformError = (code: number) => new Error(`Request "/v2/groups/g1/messages" failed with code(${code}): rejected`);

const group = { endpoint: { id: 'fixture', adapter: 'root/qq' }, kind: 'group', id: 'g1' } as never;
const c2c = { endpoint: { id: 'fixture', adapter: 'root/qq' }, kind: 'private', id: 'u1' } as never;

function harness(failures: Array<Error | undefined> = []) {
  let now = 1_000_000;
  const calls: Array<{ kind: string; message: unknown; source?: QqReplySource; msgSeq?: number }> = [];
  const send = (kind: string) => async (_id: string, message: unknown, source?: QqReplySource, options?: { msgSeq?: number }) => {
    calls.push({ kind, message, ...(source ? { source } : {}), ...(options?.msgSeq ? { msgSeq: options.msgSeq } : {}) });
    const failure = failures.shift();
    if (failure) throw failure;
    return { id: `m${calls.length}` };
  };
  const bot = { sendGroupMessage: send('group'), sendPrivateMessage: send('private'), sendGuildMessage: send('channel') } as never;
  const ledger = new QqPassiveReplyLedger(() => now);
  const activeGate = new QqActiveMessageGate(() => now);
  const logs: Array<Record<string, unknown>> = [];
  return {
    calls, ledger, activeGate, logs,
    advance: (ms: number) => { now += ms; },
    send: (conversation: never, ...messages: unknown[]) =>
      sendQqMessages({ bot, ledger, activeGate, log: fields => logs.push(fields) }, conversation, messages as never),
  };
}

describe('QqPassiveReplyLedger', () => {
  it('answers group messages passively up to 5 times with increasing msg_seq, then actively', async () => {
    const h = harness();
    h.ledger.record('group', 'g1', { id: 'u-msg' });
    for (let i = 0; i < 6; i++) await h.send(group, `reply ${i}`);
    expect(h.calls.slice(0, 5).map(call => [call.source, call.msgSeq])).toEqual(
      [1, 2, 3, 4, 5].map(seq => [{ id: 'u-msg' }, seq]),
    );
    expect(h.calls[5]!.source).toBeUndefined();
  });

  it('allows C2C 4 replies within 60 minutes', async () => {
    const h = harness();
    h.ledger.record('private', 'u1', { id: 'dm' });
    h.advance(50 * 60_000);
    for (let i = 0; i < 5; i++) await h.send(c2c, `reply ${i}`);
    expect(h.calls.filter(call => call.source)).toHaveLength(4);
  });

  it('stops using a group source before its 5-minute window closes', async () => {
    const h = harness();
    h.ledger.record('group', 'g1', { id: 'old' });
    h.advance(5 * 60_000 - 10_000);
    await h.send(group, 'late');
    expect(h.calls[0]!.source).toBeUndefined();
  });

  it('uses the newest usable source and prefers an explicit reply segment', async () => {
    const h = harness();
    h.ledger.record('group', 'g1', { id: 'first' });
    h.advance(1000);
    h.ledger.record('group', 'g1', { event_id: 'click' });
    await h.send(group, 'newest');
    await h.send(group, [{ type: 'reply', data: { id: 'first' } }, 'quoted']);
    expect(h.calls.map(call => call.source)).toEqual([{ event_id: 'click' }, { id: 'first' }]);
  });

  it('prunes conversations whose sources have all expired', () => {
    let now = 0;
    const ledger = new QqPassiveReplyLedger(() => now);
    ledger.record('group', 'g1', { id: 'a' });
    now = 6 * 60_000;
    ledger.prune();
    expect(ledger.acquire('group', 'g1')).toBeUndefined();
  });
});

describe('sendQqMessages fallbacks', () => {
  it('sends once as an active message when the source is expired or over its limit', async () => {
    const h = harness([platformError(40034128)]);
    h.ledger.record('group', 'g1', { id: 'u-msg' });
    await h.send(group, 'hi');
    expect(h.calls.map(call => call.source)).toEqual([{ id: 'u-msg' }, undefined]);
    expect(h.logs).toContainEqual(expect.objectContaining({ op: 'qq_passive_source_unusable', platformCode: 40034128 }));
    // The exhausted source is not offered again.
    await h.send(group, 'again');
    expect(h.calls[2]!.source).toBeUndefined();
  });

  it('never falls back to an active message after an unknown outcome', async () => {
    const h = harness([Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })]);
    h.ledger.record('group', 'g1', { id: 'u-msg' });
    await expect(h.send(group, 'hi')).rejects.toThrow('socket hang up');
    expect(h.calls).toHaveLength(1);
  });

  it('does not spend an active message on a content rejection', async () => {
    const h = harness([platformError(304025)]);
    h.ledger.record('group', 'g1', { id: 'u-msg' });
    await expect(h.send(group, 'blocked')).rejects.toThrow();
    expect(h.calls).toHaveLength(1);
  });

  it('remembers a conversation that refused active messages and fails fast', async () => {
    const h = harness([platformError(40034105)]);
    await expect(h.send(group, 'push')).rejects.toThrow();
    await expect(h.send(group, 'push again')).rejects.toBeInstanceOf(EndpointDeliveryError);
    expect(h.calls).toHaveLength(1);
    expect(h.logs.filter(log => log.op === 'qq_active_unavailable')).toHaveLength(1);
    // A fresh passive source still works, and the gate opens again after the backoff.
    h.ledger.record('group', 'g1', { id: 'new' });
    await h.send(group, 'reply');
    expect(h.calls[1]!.source).toEqual({ id: 'new' });
    h.advance(61 * 60_000);
    await h.send(group, 'push later');
    expect(h.calls).toHaveLength(3);
  });

  it('resends Markdown as plain text under the next msg_seq when Markdown is not allowed', async () => {
    const h = harness([platformError(304036)]);
    h.ledger.record('group', 'g1', { id: 'u-msg' });
    await h.send(group, [{ type: 'markdown', data: { content: '**加粗** [文档](https://x)' } }, { type: 'keyboard', data: {} }]);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toMatchObject({ source: { id: 'u-msg' }, msgSeq: 2, message: ['加粗 文档 https://x'] });
  });
});

describe('markdownAsText', () => {
  it('flattens Markdown, drops buttons and keeps reply and at segments', () => {
    expect(markdownAsText([{ type: 'reply', data: { id: 'r' } }, { type: 'markdown', data: { content: '# 标题\n![图](https://i)' } }, { type: 'keyboard', data: {} }]))
      .toEqual([{ type: 'reply', data: { id: 'r' } }, '标题\nhttps://i']);
    expect(markdownAsText('plain')).toBeUndefined();
  });
});
