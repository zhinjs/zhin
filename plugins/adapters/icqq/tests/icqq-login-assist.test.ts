import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import { LoginAssist } from '@zhin.js/core';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import { IcqqEndpoint } from '../src/endpoint.js';
import { resolveIcqqConfig } from '../src/protocol.js';
import { createIcqqTestPorts } from './_icqq-mock.js';

const adapterFeature = featureId('zhin.adapter');
const endpointKey = capabilityId(rootPluginId(), adapterFeature, 'icqq');
const baseConfig = resolveIcqqConfig({ id: '10001', autoReconnect: false });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEndpoint(assist: LoginAssist): IcqqEndpoint {
  const gateway: OutboundMessageService = {
    receive: vi.fn(async () => Object.freeze({ matched: true })),
    send: vi.fn(async () => 'sent'),
  };
  return bindTestEndpoint(new IcqqEndpoint({
    id: endpointKey,
    gateway,
    config: baseConfig,
    sideEvents: createIcqqTestPorts().sideEvents,
    loginAssist: assist,
  }), gateway, createIcqqTestPorts().sideEvents);
}

describe('icqq LoginAssist wiring', () => {
  it('settles start when candidate activation is aborted', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = makeEndpoint(assist);
    vi.mocked(endpoint.client.login).mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const start = endpoint.start(controller.signal);
    controller.abort(new Error('candidate rolled back'));
    await expect(start).rejects.toThrow('candidate rolled back');
  });

  it('does not register after abort while pending system requests are loading', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = makeEndpoint(assist);
    vi.mocked(endpoint.client.login).mockImplementation(async () => {
      endpoint.client.emit('system.online');
    });
    vi.mocked(endpoint.client.getSystemMsg).mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const start = endpoint.start(controller.signal);
    await flush();
    controller.abort(new Error('candidate rolled back during request pull'));
    await expect(start).rejects.toThrow('candidate rolled back during request pull');
  });

  it('qrcode challenge waits for submit then calls login()', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = makeEndpoint(assist);
    let loginCalls = 0;
    vi.mocked(endpoint.client.login).mockImplementation(async () => {
      loginCalls += 1;
      if (loginCalls === 1) {
        endpoint.client.emit('system.login.qrcode', { image: Buffer.from('png') });
      }
    });

    const startP = endpoint.start(new AbortController().signal);
    await flush();
    expect(assist.listPending()).toHaveLength(1);
    expect(assist.listPending()[0]).toMatchObject({
      type: 'qrcode',
      adapter: 'icqq',
      endpointKey: '10001',
    });
    expect(assist.listPending()[0]!.payload.image).toMatch(/^data:image\/png;base64,/);

    assist.submit(assist.listPending()[0]!.id, 'ok');
    await flush();
    expect(loginCalls).toBeGreaterThanOrEqual(2);
    endpoint.client.emit('system.online');
    await startP;
    await endpoint.stop();
  });

  it('slider challenge submits ticket via submitSlider', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = makeEndpoint(assist);
    vi.mocked(endpoint.client.login).mockImplementation(async () => {
      endpoint.client.emit('system.login.slider', { url: 'https://example.com/slider' });
    });

    const startP = endpoint.start(new AbortController().signal);
    await flush();
    expect(assist.listPending()[0]).toMatchObject({ type: 'slider' });
    assist.submit(assist.listPending()[0]!.id, 'ticket-abc');
    await flush();
    expect(endpoint.client.submitSlider).toHaveBeenCalledWith('ticket-abc');
    endpoint.client.emit('system.online');
    await startP;
    await endpoint.stop();
  });

  it('device challenge sends SMS then submits code', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = makeEndpoint(assist);
    vi.mocked(endpoint.client.login).mockImplementation(async () => {
      endpoint.client.emit('system.login.device', { url: 'https://ex', phone: '138****' });
    });

    const startP = endpoint.start(new AbortController().signal);
    await flush();
    expect(endpoint.client.sendSmsCode).toHaveBeenCalled();
    assist.submit(assist.listPending()[0]!.id, '123456');
    await flush();
    expect(endpoint.client.submitSmsCode).toHaveBeenCalledWith('123456');
    endpoint.client.emit('system.online');
    await startP;
    await endpoint.stop();
  });
});
