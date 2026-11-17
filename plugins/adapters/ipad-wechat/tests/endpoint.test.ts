import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { endpointSpec, parseAdapterDefinition } from 'zhin.js/adapter';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import plugin from '../plugin.ts';
import adapterDefinition from '../adapters/ipad-wechat/index.ts';
import { IpadWechatEndpoint, IpadWechatLoginError, resolveIpadWechatConfig } from '../src/index.js';
import type { RunResult } from '../src/sdk.js';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { FakeIpadClient, fakeSdk, message } from './fake-sdk.js';

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'ipad-wechat-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

async function setup(client = new FakeIpadClient(), receive = vi.fn(async (_payload: unknown) => undefined)) {
  const sdk = fakeSdk(client);
  const h = await createEndpointHarness(() => new IpadWechatEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'bot'),
    config: resolveIpadWechatConfig({ id: 'bot', dataDir: directory }),
    sdk,
  }), { capabilities: ['inbound', 'outbound'], gateway: createTestEventGateway({ receive }) });
  return { h, client, sdk, receive, endpoint: h.endpoint as IpadWechatEndpoint };
}

const conversation = (id: string, kind: 'private' | 'group' = 'private') =>
  ({ endpoint: { adapter: 'test-endpoint', id: 'bot' }, kind, id }) as never;

describe('plugin entry', () => {
  it('is a valid Plugin Runtime definition', () => {
    expect(plugin.name).toBe('ipad-wechat');
    expect(parseAdapterDefinition(adapterDefinition)).toBe(adapterDefinition);
  });
});

describe('IpadWechatEndpoint', () => {
  it('starts the SDK run in local signing mode and goes online', async () => {
    const { h, client, sdk, endpoint } = await setup();
    try {
      await h.start();
      expect(sdk.created).toEqual([{ dataDir: directory, signConfig: { mode: 'local' } }]);
      expect(client.runOptions).toMatchObject({ timeoutMillis: 600_000, pollIntervalMillis: 1_000, reconnect: true });
      expect(endpoint.transportState).toBe('open');
      expect(endpoint.account).toBe('wxid_bot');
    } finally { await h.stop(); }
    expect(client.closed).toBe(true);
    expect(endpoint.transportState).toBe('stopped');
  });

  it('acknowledges a message only after Zhin admitted it', async () => {
    const { h, client, receive } = await setup();
    try {
      await h.start(); h.open();
      await client.deliver(message({ conversationId: '123@chatroom', senderId: '123@chatroom', groupSenderId: 'wxid_bob', body: '/ping' }));
      expect(receive).toHaveBeenCalledOnce();
      expect(receive.mock.calls[0]![0]).toMatchObject({
        content: '/ping', sender: { id: 'wxid_bob' }, endpointId: 'bot',
        conversation: { kind: 'group', id: '123@chatroom' }, message: { id: 'm1' },
        segments: [{ type: 'text', data: { text: '/ping' } }],
      });
    } finally { await h.stop(); }
  });

  it('holds deliveries while input is closed and leaves them unacknowledged on stop', async () => {
    const { h, client, receive } = await setup();
    await h.start();
    let settled: 'ack' | 'kept' | undefined;
    const delivery = client.deliver(message()).then(() => { settled = 'ack'; }, () => { settled = 'kept'; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBeUndefined();
    expect(receive).not.toHaveBeenCalled();
    await h.stop();
    await delivery;
    expect(settled).toBe('kept');
    expect(receive).not.toHaveBeenCalled();
  });

  it('skips own messages from other devices', async () => {
    const { h, client, receive } = await setup();
    try {
      await h.start(); h.open();
      await client.deliver(message({ direction: 'outgoing', senderId: 'wxid_bot' }));
      expect(receive).not.toHaveBeenCalled();
    } finally { await h.stop(); }
  });

  it('downloads inbound images before dispatch', async () => {
    const { h, client, receive } = await setup();
    try {
      await h.start(); h.open();
      await client.deliver(message({ kind: 'image', body: '[image]', mediaHandle: 'opaque' }));
      const payload = receive.mock.calls[0]![0] as { segments: Array<{ data: { media: { value: string } } }> };
      expect(payload.segments[0]!.data.media.value).toMatch(/media[/\\]inbound[/\\][0-9a-f]{32}\.jpg$/u);
      expect(existsSync(payload.segments[0]!.data.media.value)).toBe(true);
    } finally { await h.stop(); }
  });

  it('sends group text with mentions and acknowledges the action', async () => {
    const { h, client } = await setup();
    try {
      await h.start(); h.open();
      const id = await h.send({ conversation: conversation('123@chatroom', 'group'),
        payload: [{ type: 'mention', data: { target: 'wxid_bob', name: 'Bob' } }, { type: 'text', data: { text: ' hi' } }] });
      expect(id).toBe('9000000000000000001');
      expect(client.sent).toHaveLength(1);
      const [sent] = client.sent;
      expect(sent).toMatchObject({ kind: 'text', recipient: '123@chatroom', content: '@Bob\u2005 hi', options: { at: ['wxid_bob'] } });
      expect(client.acknowledged).toEqual([(sent!.options as { operationId: string }).operationId]);
    } finally { await h.stop(); }
  });

  it('sends text and image as ordered parts', async () => {
    const { h, client } = await setup();
    try {
      await h.start(); h.open();
      const result = await h.send({ conversation: conversation('wxid_alice'),
        payload: ['look', { type: 'image', data: { media: { kind: 'base64', value: 'QUJD' } } }] });
      expect(result).toEqual({ parts: [{ messageId: '9000000000000000001' }, { messageId: '55' }] });
      expect(client.sent.map(item => item.content)).toEqual(['look', 'base64://QUJD']);
      expect(client.acknowledged).toHaveLength(2);
    } finally { await h.stop(); }
  });

  it('reports rejected and unknown sends without resending', async () => {
    const { h, client } = await setup();
    try {
      await h.start(); h.open();
      client.textResult = async () => ({ return_code: -44, output: { kind: 'send_text', receipt: null } });
      const rejected = await h.send({ conversation: conversation('wxid_alice'), payload: 'x' }).catch(error => error);
      expect(rejected).toBeInstanceOf(EndpointDeliveryError);
      expect(rejected.disposition).toBe('rejected');
      expect(client.acknowledged).toHaveLength(1);

      client.textResult = async () => { throw Object.assign(new Error('socket'), { code: 'LINK_WRITE_OUTCOME_UNKNOWN' }); };
      const unknown = await h.send({ conversation: conversation('wxid_alice'), payload: 'y' }).catch(error => error);
      expect(unknown.disposition).toBe('unknown');
      expect(client.acknowledged).toHaveLength(1);
      expect(client.sent).toHaveLength(2);
    } finally { await h.stop(); }
  });

  it('lists contacts and group members through management', async () => {
    const { h, endpoint } = await setup();
    try {
      await h.start();
      const management = endpoint[endpointSpec] && (endpoint as unknown as { endpointManagement: Required<import('zhin.js/adapter').EndpointManagement> }).endpointManagement;
      await expect(management.listFriends()).resolves.toEqual([{ user_id: 'wxid_alice', nickname: 'Alice', remark: 'A' }]);
      await expect(management.listGroups()).resolves.toEqual([{ group_id: '123@chatroom', name: '测试群' }]);
      await expect(management.listGroupMembers({ groupId: '123@chatroom' }))
        .resolves.toEqual([{ user_id: 'wxid_alice', nickname: 'Alice', card: '群名片' }]);
    } finally { await h.stop(); }
  });

  it('writes the login QR code and fails start when verification is required', async () => {
    const client = new FakeIpadClient();
    client.onRun = async (options) => {
      await options.onLoginStep?.({ request_id: 'r', sequence: 1, state_version: 1, return_code: 0,
        output: { kind: 'qr_code', message: '', accepted: true, image: [0x89, 0x50, 0x4e, 0x47], check_time: null, expires_at: null } } as never);
      return { status: 'login_incomplete', login: { method: 'qr', status: 'verification_required' }, online: null } as unknown as RunResult;
    };
    const { h } = await setup(client);
    try {
      const error = await h.start().catch(failure => failure);
      expect(String(error?.message ?? error)).toMatch(/verification/u);
      expect([...readFileSync(join(directory, 'login-qrcode.png'))]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    } finally { await h.stop(); }
    expect(IpadWechatLoginError).toBeTypeOf('function');
  });
});
