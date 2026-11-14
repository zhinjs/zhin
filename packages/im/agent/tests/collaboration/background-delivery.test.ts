/**
 * #1250 delegate-result-lost-after-turn: results of delegated work arrive after
 * the root turn ended, when the message's reply scope is closed. They go out as
 * proactive messages through the turn's delivery port (Runtime outbound port);
 * a failed delivery tells the human the background task failed.
 */
import { vi } from 'vitest';
import { createBackgroundTeller } from '../../src/collaboration/turn-collaboration.js';
import { HostMailbox } from '../../src/collaboration/host-mailbox.js';
import type { CollaborationDirectory } from '../../src/collaboration/contracts.js';
import type { DeliveryOutcome, DeliveryPort, ReplyPort, TurnIngress } from '../../src/turn/turn-ingress.js';

function turn(ports: Partial<{ delivery: DeliveryPort; reply: ReplyPort }>, locale = 'zh-CN', unattended = false): TurnIngress {
  return {
    identity: { rootId: 'root', generation: 1, traceId: 't', turnId: 'turn-1' },
    input: { text: 'hi', locale },
    policy: { permissions: [], unattended },
    ports: { journal: { append: () => undefined }, ...ports },
  } as unknown as TurnIngress;
}

const closedReply: ReplyPort = { send: vi.fn(async () => { throw new Error('Message reply scope has ended'); }) };

function delivery(...outcomes: DeliveryOutcome[]) {
  const deliver = vi.fn<DeliveryPort['deliver']>(async () => outcomes.shift() ?? { status: 'sent' });
  return { deliver };
}

const texts = (port: { deliver: ReturnType<typeof vi.fn> }) =>
  port.deliver.mock.calls.map(([intent]) => (intent as Parameters<DeliveryPort['deliver']>[0]).output.map(item => (item as { content?: string }).content).join(''));

describe('background collaboration delivery', () => {
  it('delivers the aggregated result proactively, never through the closed reply scope', async () => {
    const port = delivery();
    const teller = createBackgroundTeller(turn({ delivery: port, reply: closedReply }));
    await teller.deliverResult({ status: 'completed', content: '  researcher says: 42  ' }, new AbortController().signal);
    expect(texts(port)).toEqual(['researcher says: 42']);
    expect(port.deliver.mock.calls[0]![0]).toMatchObject({ parentTurnId: 'turn-1', target: { conversation: 'origin' } });
    expect(closedReply.send).not.toHaveBeenCalled();
  });

  it('sends a short failure notice when the result cannot be delivered', async () => {
    const port = delivery({ status: 'failed', code: 'endpoint_offline', retryable: true });
    await createBackgroundTeller(turn({ delivery: port })).deliverResult({ status: 'completed', content: 'long answer' }, new AbortController().signal);
    expect(texts(port)).toEqual(['long answer', '后台任务失败：结果没能发出来，请稍后再试。']);
  });

  it('tells the human when the aggregating turn itself failed, in their language', async () => {
    const port = delivery();
    await createBackgroundTeller(turn({ delivery: port }, 'en-US')).deliverResult({ status: 'failed', content: 'AI provider: operation-closed' }, new AbortController().signal);
    expect(texts(port)).toEqual(['A background task failed: its result could not be delivered. Please try again.']);
  });

  it('stays silent for a cancelled result and for unattended turns', async () => {
    const port = delivery();
    await createBackgroundTeller(turn({ delivery: port })).deliverResult({ status: 'cancelled' }, new AbortController().signal);
    await createBackgroundTeller(turn({ delivery: port }, 'zh-CN', true)).deliverResult({ status: 'completed', content: 'x' }, new AbortController().signal);
    expect(port.deliver).not.toHaveBeenCalled();
  });

  it('never throws when a host has neither delivery nor a live reply scope', async () => {
    const teller = createBackgroundTeller(turn({ reply: closedReply }));
    await expect(teller.deliverResult({ status: 'completed', content: 'x' }, new AbortController().signal)).resolves.toBeUndefined();
    await expect(teller.tell('协作已暂停', new AbortController().signal)).resolves.toBeUndefined();
  });
});

describe('collaboration binding lifetime', () => {
  const directory = { entry: { name: 'zhin' }, get: () => undefined, list: () => [] } as unknown as CollaborationDirectory;

  it('releases what a binding holds when its engagement closes', async () => {
    const mailbox = new HostMailbox();
    const admission = await mailbox.admit({ sessionKey: 's', senderId: 'u', text: 'hi', plainText: true });
    if (admission.kind !== 'run') throw new Error(`expected run, got ${admission.kind}`);
    const onClosed = vi.fn();
    mailbox.bindCollaboration(admission.mail.engagementId, { directory, runTurn: async () => ({ status: 'completed' }), onClosed });
    admission.release('completed');
    await mailbox.idle();
    expect(onClosed).toHaveBeenCalledTimes(1);
    await mailbox.close();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('releases open bindings when the Mailbox closes', async () => {
    const mailbox = new HostMailbox();
    const onClosed = vi.fn();
    mailbox.bindCollaboration('engagement-x' as never, { directory, runTurn: async () => ({ status: 'completed' }), onClosed });
    await mailbox.close();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
