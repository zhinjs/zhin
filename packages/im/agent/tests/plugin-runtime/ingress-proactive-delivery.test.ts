/**
 * #1250: the IM turn's delivery port sends proactive messages to the original
 * conversation through the Runtime outbound port (`ImRuntime.send`, the unified
 * send chain), never through the message's reply scope.
 */
import { vi } from 'vitest';
import { createIngressReplyPort } from '../../src/plugin-runtime/ingress/ingress-outbound.js';

function fixture(options: { blocked?: boolean } = {}) {
  const conversation = { kind: 'private', id: 'owner', endpoint: { id: 'sandbox', adapter: 'sandbox' } };
  const send = vi.fn(async () => ({ status: 'sent', message: { id: 'out-1' } }));
  const reply = vi.fn(async () => { throw new Error('Message reply scope has ended'); });
  const audit = vi.fn();
  const markSpoke = vi.fn();
  const port = createIngressReplyPort({
    message: { conversation, locale: 'zh-CN', sender: { id: 'owner' }, message: { id: 'm-1' } },
    snapshot: { capabilities: new Map(), resources: new Map() },
    requester: 'root',
    signal: new AbortController().signal,
    operationSession: undefined,
    sessionKey: 's',
    effectiveAdapter: 'sandbox',
    platformCapabilities: undefined,
    turnPolicy: { filesystem: { workspaceRoot: '/ws', workingDirectory: '/ws', access: 'workspace-write' } },
    service: {},
    im: { send },
    admission: { markDelivered: vi.fn() },
    liveDanmaku: undefined,
    mergedSenders: undefined,
    reactionPacer: {},
    audit,
    reply,
    hooks: { markSpoke, staleReplyBlocked: () => true, outboundBlocked: () => options.blocked === true },
  } as never);
  return { port, send, reply, audit, markSpoke, conversation };
}

const intent = (text: string) => ({ intentId: 'i', parentTurnId: 'turn-1', target: { conversation: 'origin' }, output: [{ type: 'text' as const, content: text }] });

it('sends through ImRuntime.send to the original conversation after the reply scope closed', async () => {
  const f = fixture();
  const outcome = await f.port.delivery.deliver(intent('后台结果'), new AbortController().signal);
  expect(outcome.status).toBe('sent');
  expect(f.reply).not.toHaveBeenCalled();
  expect(f.send).toHaveBeenCalledTimes(1);
  const request = (f.send.mock.calls[0] as unknown[])[0] as { conversation: unknown; requester: unknown; content: unknown };
  expect(request.conversation).toBe(f.conversation);
  expect(request.requester).toBe('root');
  expect(JSON.stringify(request.content)).toContain('后台结果');
  expect(f.markSpoke).toHaveBeenCalled();
  expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'outbound_sent', payload: expect.objectContaining({ proactive: true }) }));
});

it('respects the outbound control switch', async () => {
  const f = fixture({ blocked: true });
  const outcome = await f.port.delivery.deliver(intent('x'), new AbortController().signal);
  expect(outcome.status).toBe('suppressed');
  expect(f.send).not.toHaveBeenCalled();
});
