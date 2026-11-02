import { Bot, ReceiverMode, type StreamMessagePayload } from 'qq-official-bot';
import type { ConversationRef } from '@zhin.js/im-contract';
import { createQqStreaming } from '../src/streaming.js';
import { QqPassiveReplyLedger } from '../src/passive-reply.js';

const conversation: ConversationRef = { endpoint: { id: 'qq', adapter: 'qq' }, kind: 'private', id: 'user' };

function fixture() {
  const bot = new Bot({ mode: ReceiverMode.WEBSOCKET, appid: 'fixture', secret: 'fixture' });
  const calls: StreamMessagePayload[] = [];
  const send = vi.spyOn(bot.messageService, 'sendPrivateStreamMessage').mockImplementation(async (_target, payload) => {
    calls.push(payload);
    return { id: 'native-1', timestamp: 'fixture' };
  });
  const ledger = new QqPassiveReplyLedger();
  ledger.record('private', 'user', { id: 'source' });
  return { bot, calls, send, ledger, streaming: createQqStreaming(() => bot, ledger) };
}

describe('QQ native C2C reply stream', () => {
  it('uses the real SDK stream state with one passive grant and native delta frames', async () => {
    const { streaming, calls, ledger } = fixture();
    const stream = streaming.open({ conversation, format: 'markdown', source: { messageId: 'source' } })!;
    expect(await stream.write('first')).toMatchObject({ status: 'sent', acceptedText: 'first', messageId: 'private-user:native-1' });
    await stream.write('first second');
    await stream.write('first second');
    const finished = stream.finish('first second third');
    expect(stream.finish('first second third')).toBe(finished);
    await finished;
    expect(calls).toMatchObject([
      { input_state: 1, index: 0, content_type: 'markdown', content_raw: 'first', msg_id: 'source', msg_seq: 1 },
      { input_state: 1, index: 1, content_raw: ' second', stream_msg_id: 'native-1', msg_seq: 1 },
      { input_state: 10, index: 2, content_raw: ' third', stream_msg_id: 'native-1', msg_seq: 1 },
    ]);
    expect(ledger.acquire('private', 'user')?.msgSeq).toBe(2);
  });

  it('does not expose unsupported group, guild-DM or mention combinations', () => {
    const { streaming, calls } = fixture();
    expect(streaming.supports!({ conversation })).toBe(true);
    expect(streaming.supports!({ conversation: { ...conversation, kind: 'group' } })).toBe(false);
    expect(streaming.supports!({ conversation: { ...conversation, parent: { kind: 'channel', id: 'guild' } } })).toBe(false);
    expect(streaming.open({ conversation: { ...conversation, kind: 'group' }, format: 'text' })).toBeUndefined();
    expect(streaming.open({ conversation: { ...conversation, parent: { kind: 'channel', id: 'guild' } }, format: 'text' })).toBeUndefined();
    expect(streaming.open({ conversation, format: 'markdown', prefix: [{ type: 'mention', data: { target: 'user' } }] })).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('cancels locally without a final frame or an ordinary message', async () => {
    const { streaming, calls } = fixture();
    const stream = streaming.open({ conversation, format: 'text' })!;
    await stream.write('partial');
    stream.cancel();
    await expect(stream.finish('partial final')).rejects.toMatchObject({ code: 'endpoint_inactive' });
    expect(calls).toHaveLength(1);
  });

  it('does not retry an unknown native request outcome', async () => {
    const { streaming, send } = fixture();
    send.mockRejectedValueOnce(new Error('socket closed'));
    const stream = streaming.open({ conversation, format: 'text' })!;
    await expect(stream.write('partial')).rejects.toMatchObject({ disposition: 'unknown' });
    await expect(stream.finish('partial final')).rejects.toMatchObject({ disposition: 'unknown' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses an exhausted passive source without upgrading to an active message', async () => {
    const { streaming, ledger, calls } = fixture();
    for (let n = 0; n < 4; n++) ledger.acquire('private', 'user');
    const stream = streaming.open({ conversation, format: 'text' })!;
    await expect(stream.write('reply')).rejects.toMatchObject({ disposition: 'not_sent' });
    expect(calls).toEqual([]);
  });

  it('stops accepting additional text when QQ reports an exhausted native container', async () => {
    const { streaming, send } = fixture();
    send.mockResolvedValueOnce({ id: 'native-1', timestamp: 'fixture', remain_msg_len: 0 });
    const stream = streaming.open({ conversation, format: 'text' })!;
    expect(await stream.write('accepted')).toMatchObject({ acceptedText: 'accepted', exhausted: true });
    expect(await stream.write('accepted tail')).toMatchObject({ acceptedText: 'accepted', exhausted: true });
    expect(send).toHaveBeenCalledTimes(1);
    await stream.finish('accepted');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('ends its logical wait on cancellation even when the native SDK request cannot be aborted', async () => {
    const { streaming, send } = fixture();
    let finish!: (value: { id: string; timestamp: string }) => void;
    send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const stream = streaming.open({ conversation, format: 'text' })!;
    const pending = stream.write('partial');
    stream.cancel();
    await expect(pending).rejects.toMatchObject({ disposition: 'unknown' });
    finish({ id: 'late', timestamp: 'fixture' });
    await expect(stream.finish('partial')).rejects.toMatchObject({ disposition: 'unknown' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('restores fenced-code context in a continuation without counting generated markup as source', async () => {
    const { streaming, calls, send } = fixture();
    send.mockImplementationOnce(async (_target, payload) => {
      calls.push(payload);
      return { id: 'native-1', timestamp: 'fixture', remain_msg_len: 0 };
    });
    const first = streaming.open({ conversation, format: 'markdown' })!;
    const before = '```typescript\nconst first = 1;';
    const accepted = await first.write(before);
    expect(accepted).toMatchObject({ acceptedText: before, exhausted: true });
    await first.finish(before);
    expect(calls[1]).toMatchObject({ input_state: 10, content_raw: '' });
    const next = streaming.open({ conversation, format: 'markdown', continuation: { precedingText: before } })!;
    const remainder = '\nconst second = 2;\n```';
    expect(await next.write(remainder)).toMatchObject({ acceptedText: remainder, contentUnavailable: true });
    await next.finish(remainder);
    expect(calls[2]).toMatchObject({ content_raw: `\`\`\`typescript\n${remainder}`, index: 0, msg_seq: 2 });
    expect(calls[3]).toMatchObject({ content_raw: '', input_state: 10, index: 1, msg_seq: 2 });
    expect(accepted.acceptedText + remainder).toBe(before + remainder);
  });

  it('rejects unsupported inline continuation before submitting a replacement stream', () => {
    const { streaming, calls } = fixture();
    expect(() => streaming.open({ conversation, format: 'markdown', continuation: { precedingText: '[incomplete' } }))
      .toThrow('plain block boundary');
    expect(calls).toEqual([]);
  });
});
