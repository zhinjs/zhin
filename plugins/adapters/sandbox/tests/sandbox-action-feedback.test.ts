import React, { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WebSocket from 'ws';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { SandboxWsEndpoint } from '../src/endpoint.js';
import { resolveSandboxEndpoint } from '../src/protocol.js';
import { renderSandboxSegment, type SandboxSegmentRenderContext } from '../pages/index/segments/index.js';
import {
  markPlaygroundActionSubmitted,
  sandboxActionSegment,
  setPlaygroundActionFeedback,
  type PlaygroundMessage,
} from '../pages/index/playgroundState.js';
import { actionOutcomeFeedback, type ConversationOutcome } from '../pages/index/conversationRecovery.js';
import { sandboxOperations } from './sandbox-operations.js';

(globalThis as { React?: typeof React }).React = React;

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.close())); });

const context = (patch: Partial<SandboxSegmentRenderContext> = {}): SandboxSegmentRenderContext => ({
  locale: 'zh-CN', isSent: false, messageId: 'card-1', interactionResolved: false, canInteract: true,
  sendAction: () => true, renderNested: () => null, ...patch,
});

/** Every element with an `onClick` in a rendered tree, in order. */
function clickables(node: ReactNode, found: Array<{ props: Record<string, any> }> = []): Array<{ props: Record<string, any> }> {
  if (Array.isArray(node)) { for (const child of node) clickables(child, found); return found; }
  if (!isValidElement(node)) return found;
  const props = node.props as Record<string, any>;
  if (typeof props.onClick === 'function') found.push({ props });
  clickables(props.children, found);
  return found;
}

const keyboard = (purpose?: string) => ({ type: 'keyboard', data: {
  ...(purpose ? { purpose } : {}),
  rows: [[{ id: 'activity:42:1', label: '报名', payload: 'join' }, { id: 'activity:42:2', label: '取消', payload: 'leave' }]],
} });

async function sandboxEndpoint(receive: OutboundMessageService['receive']) {
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  hosts.push(http);
  const endpoint = await createEndpointHarness(() => new SandboxWsEndpoint({
    id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'), http,
    defaults: resolveSandboxEndpoint({ id: 'demo-bot', owner: 'sandbox-user' }),
  }), { name: 'sandbox', capabilities: ['inbound', 'outbound'], operations: sandboxOperations,
    gateway: createTestEventGateway({ receive, send: vi.fn(async () => 'sent') }, undefined) });
  await endpoint.start();
  endpoint.open();
  const { port } = await http.listen();
  const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
  const frames: Record<string, any>[] = [];
  client.on('message', (raw) => frames.push(JSON.parse(String(raw))));
  await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
  await vi.waitFor(() => expect(frames.some((frame) => frame.type === 'ready')).toBe(true));
  return { client, frames, stop: async () => { client.close(); await endpoint.stop(); } };
}

describe('#1250 sandbox-action-button-id-dropped', () => {
  it('sends the clicked button id and its payload separately, and both reach the inbound message', async () => {
    const clicks: Array<[string, string | undefined]> = [];
    const tree = renderSandboxSegment(keyboard(), context({ sendAction: (payload, buttonId) => { clicks.push([payload, buttonId]); return true; } }), 0);
    clickables(tree)[0]!.props.onClick();
    expect(clicks).toEqual([['join', 'activity:42:1']]);

    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const sandbox = await sandboxEndpoint(receive);
    try {
      const [payload, buttonId] = clicks[0]!;
      sandbox.client.send(JSON.stringify({ type: 'group', id: 'room', messageId: 'click-1', content: [sandboxActionSegment(payload, buttonId)] }));
      await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    } finally { await sandbox.stop(); }
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      content: 'join',
      segments: [{ type: 'action', data: { id: 'activity:42:1', payload: 'join' } }],
      metadata: expect.objectContaining({ action: { id: 'activity:42:1', payload: 'join' } }),
    }));
  });

  it('falls back to the payload only for a button without an id', () => {
    expect(sandboxActionSegment('join')).toEqual({ type: 'action', data: { id: 'join', payload: 'join' } });
  });
});

describe('#1250 sandbox-submitted-without-feedback', () => {
  it('pushes a gateway processing failure back to the page, naming the input', async () => {
    const receive = vi.fn(async () => { throw new Error('handler exploded'); });
    const sandbox = await sandboxEndpoint(receive);
    try {
      sandbox.client.send(JSON.stringify({ type: 'group', id: 'room', messageId: 'click-2', content: [sandboxActionSegment('join', 'activity:42:1')] }));
      await vi.waitFor(() => expect(sandbox.frames.some((frame) => frame.type === 'error' && frame.code === 'sandbox_gateway_receive_failed')).toBe(true));
    } finally { await sandbox.stop(); }
    const error = sandbox.frames.find((frame) => frame.code === 'sandbox_gateway_receive_failed')!;
    expect(error).toMatchObject({ messageId: 'click-2', conversation: { type: 'group', id: 'room' } });
    expect(error.content[0].data.text).toContain('handler exploded');
  });

  it('keeps the other buttons of a card usable after one click; an approval is still a single choice', () => {
    const card = renderToStaticMarkup(React.createElement(React.Fragment, null,
      renderSandboxSegment(keyboard(), context({ interactionResolved: true, submittedPayloads: ['join'] }), 0)));
    expect(card).not.toMatch(/<button[^>]*\sdisabled=""/u);
    expect(card).toMatch(/<button[^>]*aria-pressed="true"[^>]*>.*报名/u);
    expect(card).not.toContain('已提交本次选择');
    const approval = renderToStaticMarkup(React.createElement(React.Fragment, null,
      renderSandboxSegment(keyboard('approval'), context({ interactionResolved: true, submittedPayloads: ['join'] }), 0)));
    expect(approval.match(/<button[^>]*\sdisabled=""/gu)).toHaveLength(2);
    expect(approval).toContain('已提交本次选择');
  });

  const message = (id: string, type: PlaygroundMessage['type'], timestamp: number): PlaygroundMessage => ({
    id, type, channelType: 'group', channelId: 'room', channelName: 'Room', senderId: 'bot', senderName: 'Bot',
    content: [keyboard()], timestamp,
  });
  const scene = { type: 'group' as const, id: 'room' };

  it('records submitted payloads per card and clears earlier feedback on the next click', () => {
    let messages = [message('card-1', 'received', 1)];
    messages = setPlaygroundActionFeedback(messages, scene, 'card-1', { tone: 'error', text: 'failed' });
    messages = markPlaygroundActionSubmitted(messages, scene, 'card-1', 'join');
    messages = markPlaygroundActionSubmitted(messages, scene, 'card-1', 'leave');
    expect(messages[0]).toMatchObject({ interactionResolved: true, submittedActions: ['join', 'leave'] });
    expect(messages[0]!.actionFeedback).toBeUndefined();
  });

  it('shows 「没有收到机器人的处理结果」 only when the Bot posted nothing since the click', () => {
    const quiet = { tone: 'quiet' as const, text: '没有收到机器人的处理结果' };
    const silent = setPlaygroundActionFeedback([message('card-1', 'received', 1)], scene, 'card-1', quiet, 10);
    expect(silent[0]!.actionFeedback).toEqual(quiet);
    const answered = setPlaygroundActionFeedback([message('card-1', 'received', 1), message('reply', 'received', 12)], scene, 'card-1', quiet, 10);
    expect(answered[0]!.actionFeedback).toBeUndefined();
  });

  it('turns the click outcome into an error, a quiet notice, or nothing for a reply', () => {
    const outcome = (patch: Partial<ConversationOutcome>): ConversationOutcome => ({
      id: 'o', settledAt: 1, outcome: 'replied', stage: 'interaction', addressed: true, reply: 'yes', text: '已回复', ...patch,
    });
    expect(actionOutcomeFeedback(outcome({ outcome: 'internal_error', reply: 'no', text: '处理出错' }))).toEqual({ tone: 'error', text: '处理出错（internal_error）' });
    expect(actionOutcomeFeedback(outcome({ outcome: 'interaction_consumed', reply: 'no', text: '已处理' }))?.tone).toBe('quiet');
    expect(actionOutcomeFeedback(outcome({}))).toBeNull();
    expect(actionOutcomeFeedback(undefined)).toBeNull();
  });
});
