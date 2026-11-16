import WebSocket from 'ws';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdapterIndex, adapterFeatureId, endpointEventGatewayToken } from '@zhin.js/adapter';
import { createCapabilitySlot, createSnapshotView, SnapshotStore, rootPluginId, projectLocaleToken, type SnapshotState } from 'zhin.js';
import { ImRuntime, type RuntimeMessageEvent } from '@zhin.js/core/runtime';
import { OUTBOUND_SEGMENT_CATALOG } from '@zhin.js/core';
import { MemoryConversationEventStore } from '@zhin.js/im-contract';
import { httpHostToken } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import sandboxAdapter from '../adapters/sandbox/index.js';
import { renderSandboxSegments, type SandboxSegmentRenderContext } from '../pages/index/segments/index.js';

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: (_file: string, _args: readonly string[], _options: object,
    callback: (error: Error | null, stdout: string) => void) => queueMicrotask(() => callback(null, 'synthetic-version')),
}));

(globalThis as { React?: typeof React }).React = React;

const pageContext: SandboxSegmentRenderContext = {
  locale: 'zh-CN', isSent: false, interactionResolved: false, canInteract: true,
  sendAction: () => true, renderNested: () => null,
};

/** ADR 0064 §6 / D10: the Sandbox takes no degradation path, in Core and in the page. */
describe('Sandbox capability parity through the real outbound chain (ADR 0064)', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });

  async function start() {
    const root = rootPluginId(), abort = new AbortController(), events = new MemoryConversationEventStore();
    const im = new ImRuntime({ conversationEvents: events });
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'sandbox',
      source: '/fixture/adapters/sandbox/index.ts', definition: sandboxAdapter });
    const state: SnapshotState = {
      root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
      config: new Map([[root, { id: 'parity-bot', owner: 'parity-owner' }]]),
      resources: new Map([[root, new Map([[httpHostToken.id, http], [endpointEventGatewayToken.id, im.endpointEvents], [projectLocaleToken.id, 'zh-CN']])]]),
      capabilities: new Map([[slot.id, slot]]), projections: new Map(),
    };
    const adapters = await AdapterIndex.create([slot], createSnapshotView(0, state), abort.signal);
    const snapshots = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, adapters]]) });
    im.attach(snapshots);
    const conversation = { endpoint: { adapter: 'sandbox', id: String(slot.id) }, kind: 'group' as const, id: 'parity-room' };
    const observed: RuntimeMessageEvent[] = [];
    const unsubscribe = im.messageEvents.subscribe(event => { if (event.direction === 'outbound') observed.push(event); });
    const frames: Record<string, any>[] = [];
    await adapters.start(); adapters.open();
    const { port } = await http.listen();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
    socket.on('message', raw => frames.push(JSON.parse(String(raw))));
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'ready')).toBe(true));
    socket.send(JSON.stringify({ op: 'subscribe', conversation: { type: 'group', id: conversation.id } }));
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'subscribed')).toBe(true));
    close = async () => {
      unsubscribe(); socket.terminate(); abort.abort();
      await adapters.stop(); await snapshots.close(); await http.close();
    };
    return { im, root, conversation, frames, observed };
  }

  it('delivers every catalog segment unchanged with an empty degradation, and the page has a renderer for each', async () => {
    const { im, root, conversation, frames, observed } = await start();
    for (const entry of OUTBOUND_SEGMENT_CATALOG) {
      const before = frames.length;
      const receipt = await im.send({ requester: root, conversation, content: [entry.example] });
      expect(receipt.status, entry.type).toBe('sent');
      await vi.waitFor(() => expect(frames.length).toBeGreaterThan(before));
      const frame = frames.slice(before).find(item => Array.isArray(item.content))!;
      expect(frame.content.map((segment: { type: string }) => segment.type), entry.type).toEqual([entry.canonicalType]);
      // Core: no fallback reason on the delivery.
      expect(observed.at(-1)?.rendering?.fallbacks, entry.type).toEqual([]);
      // Page: the delivered segment reaches its dedicated renderer, never the `[type]` fallback.
      const html = renderToStaticMarkup(React.createElement(React.Fragment, null, ...renderSandboxSegments(frame.content, pageContext)));
      expect(html, entry.type).not.toContain('sandbox-segment-note');
    }
  });

  it('delivers one mixed message of the whole catalog in order without degradation', async () => {
    const { im, root, conversation, frames, observed } = await start();
    const receipt = await im.send({ requester: root, conversation, content: OUTBOUND_SEGMENT_CATALOG.map(entry => entry.example) });
    expect(receipt.status).toBe('sent');
    await vi.waitFor(() => expect(frames.some(frame => Array.isArray(frame.content) && frame.content.length > 1)).toBe(true));
    const frame = frames.find(item => Array.isArray(item.content) && item.content.length > 1)!;
    expect(frame.content.map((segment: { type: string }) => segment.type)).toEqual(OUTBOUND_SEGMENT_CATALOG.map(entry => entry.canonicalType));
    expect(observed.at(-1)?.rendering?.fallbacks).toEqual([]);
    // D5: the HTML card without a width arrives with its design width.
    expect(frame.content.find((segment: { type: string }) => segment.type === 'html').data.width).toBe(540);
  });

  it('performs recall, edit and reaction as Sandbox wire frames (P1b, D9)', async () => {
    const { im, root, conversation, frames } = await start();
    const receipt = await im.send({ requester: root, conversation, content: 'original' });
    const message = { conversation, id: receipt.status === 'sent' ? receipt.message!.id : '' };
    expect(message.id).toBeTruthy();
    expect(await im.endpoints.edit({ message, content: [{ type: 'markdown', data: { content: '**edited**' } }] })).toBe(message.id);
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'edit')).toBe(true));
    expect(frames.find(frame => frame.type === 'edit')).toMatchObject({ messageId: message.id,
      conversation: { type: 'group', id: conversation.id }, content: [{ type: 'markdown', data: { content: '**edited**' } }] });
    const reactionId = await im.endpoints.addReaction({ message, emoji: '👍' });
    expect(reactionId).toEqual(expect.any(String));
    await im.endpoints.removeReaction({ message, reactionId: reactionId! });
    await im.endpoints.recall({ message });
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'recall')).toBe(true));
    expect(frames.filter(frame => frame.type === 'reaction')).toEqual([
      expect.objectContaining({ messageId: message.id, op: 'add', emoji: '👍', reactionId }),
      expect.objectContaining({ messageId: message.id, op: 'remove', reactionId }),
    ]);
    expect(frames.find(frame => frame.type === 'recall')).toMatchObject({ messageId: message.id, conversation: { type: 'group', id: conversation.id } });
  });

  it('does not report a control operation as done without a live page', async () => {
    const { im, conversation } = await start();
    const message = { conversation: { ...conversation, id: 'nobody-watching' }, id: 'm-1' };
    await expect(im.endpoints.recall({ message })).rejects.toMatchObject({ code: 'sandbox_delivery_unavailable' });
  });
});
