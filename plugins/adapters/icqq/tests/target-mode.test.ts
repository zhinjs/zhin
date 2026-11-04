import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@icqqjs/icqq';
import { LoginAssist } from '@zhin.js/core';
import { loginAssistToken } from '@zhin.js/core/runtime';
import { projectLocaleToken } from 'zhin.js/i18n';
import type { EndpointEvent } from 'zhin.js/adapter';
import { createAdapterHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import definition from '../adapters/icqq/index.js';
import { IcqqAdapter } from '../src/adapter.js';
import { IcqqEndpoint } from '../src/endpoint.js';

afterEach(() => vi.restoreAllMocks());

it('keeps the installed ICQQ Client prototype and sends the identical rich SDK event through the real factory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-icqq-target-'));
  vi.spyOn(Client.prototype, 'login').mockImplementation(async function () {
    Reflect.apply(this.emit, this, ['system.online', {}]);
  });
  vi.spyOn(Client.prototype, 'getSystemMsg').mockResolvedValue([]);
  vi.spyOn(Client.prototype, 'terminate').mockImplementation(() => undefined);
  const events: EndpointEvent[] = [];
  const harness = await createAdapterHarness(definition, { id: '12345678', dataDir: directory, autoReconnect: false }, {
    name: 'icqq', resources: new Map([
      [loginAssistToken.id, new LoginAssist(null)], [projectLocaleToken.id, 'zh-CN'],
    ]), gateway: createTestEndpointEventGateway({ receive: async event => { events.push(event); } }),
  });
  try {
    expect(harness.adapter).toBeInstanceOf(IcqqAdapter);
    const endpoint = harness.endpoint;
    if (!(endpoint instanceof IcqqEndpoint)) throw new Error('Factory did not produce the real Endpoint');
    expect(endpoint).toBeInstanceOf(Client);
    expect(endpoint.on).toBe(Client.prototype.on);
    expect(endpoint.emit).toBe(Client.prototype.emit);
    expect(Object.hasOwn(IcqqEndpoint.prototype, 'start')).toBe(false);
    expect('client' in endpoint).toBe(false);
    await harness.start(); harness.open();
    class NativeMessage {
      post_type = 'message'; message_type = 'private'; user_id = 2;
      message_id = 'native-message'; time = 1_700_000_000; raw_message = 'hello';
      message = [{ type: 'text', text: 'hello' }]; sender = { nickname: 'Alice' };
      readonly bytes = Buffer.from('native');
      reply(): string { return 'native method'; }
    }
    const raw = new NativeMessage();
    Reflect.apply(endpoint.emit, endpoint, ['message.private', raw]);
    await vi.waitFor(() => expect(events.some(event => event.name === 'message.receive')).toBe(true));
    const received = events.find(event => event.name === 'message.receive')!;
    expect(received.client).toBe(endpoint);
    expect((received.payload as { event: unknown }).event).toBe(raw);
    expect(received.payload).toMatchObject({ platformSentAt: 1_700_000_000_000 });
  } finally { await harness.stop(); await rm(directory, { recursive: true, force: true }); }
});
