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

function makeEndpoint(assist: LoginAssist, locale: 'zh-CN' | 'en' = 'zh-CN', lifetime: Pick<ConstructorParameters<typeof IcqqEndpoint>[0], 'signal' | 'endpointIdentity'> = {}): IcqqEndpoint {
  const gateway: OutboundMessageService = {
    receive: vi.fn(async () => Object.freeze({ matched: true })),
    send: vi.fn(async () => 'sent'),
  };
  return bindTestEndpoint(new IcqqEndpoint({
    id: endpointKey,
    gateway,
    config: baseConfig,
    sideEvents: createIcqqTestPorts().sideEvents,
    loginAssist: assist, locale, ...lifetime,
  }), gateway, createIcqqTestPorts().sideEvents);
}

describe('icqq LoginAssist wiring', () => {
  it('settles start when candidate activation is aborted', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = makeEndpoint(assist);
    vi.mocked(endpoint.login).mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const start = endpoint.start(controller.signal);
    controller.abort(new Error('candidate rolled back'));
    await expect(start).rejects.toThrow('candidate rolled back');
  });

  it('does not register after abort while pending system requests are loading', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = makeEndpoint(assist);
    vi.mocked(endpoint.login).mockImplementation(async () => {
      endpoint.emit('system.online');
    });
    vi.mocked(endpoint.getSystemMsg).mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const start = endpoint.start(controller.signal);
    await flush();
    controller.abort(new Error('candidate rolled back during request pull'));
    await expect(start).rejects.toThrow('candidate rolled back during request pull');
  });

  it.each(['zh-CN', 'en'] as const)('qrcode challenge uses project %s and waits for submit before login()', async locale => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = makeEndpoint(assist, locale);
    let loginCalls = 0;
    vi.mocked(endpoint.login).mockImplementation(async () => {
      loginCalls += 1;
      if (loginCalls === 1) {
        endpoint.emit('system.login.qrcode', { image: Buffer.from('png') });
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
    expect(assist.listPending()[0]!.payload.message).toContain(locale === 'en' ? 'Scan the QR code' : '扫码登录');
    expect(assist.listPending()[0]!.payload.image).toMatch(/^data:image\/png;base64,/);

    assist.submit(assist.listPending()[0]!.id, 'ok');
    await flush();
    expect(loginCalls).toBeGreaterThanOrEqual(2);
    endpoint.emit('system.online');
    await startP;
    await endpoint.stop();
  });

  it('slider challenge submits ticket via submitSlider', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = makeEndpoint(assist);
    vi.mocked(endpoint.login).mockImplementation(async () => {
      endpoint.emit('system.login.slider', { url: 'https://example.com/slider' });
    });

    const startP = endpoint.start(new AbortController().signal);
    await flush();
    expect(assist.listPending()[0]).toMatchObject({ type: 'slider' });
    assist.submit(assist.listPending()[0]!.id, 'ticket-abc');
    await flush();
    expect(endpoint.submitSlider).toHaveBeenCalledWith('ticket-abc');
    endpoint.emit('system.online');
    await startP;
    await endpoint.stop();
  });

  it('device challenge sends SMS then submits code', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = makeEndpoint(assist);
    vi.mocked(endpoint.login).mockImplementation(async () => {
      endpoint.emit('system.login.device', { url: 'https://ex', phone: '138****' });
    });

    const startP = endpoint.start(new AbortController().signal);
    await flush();
    expect(endpoint.sendSmsCode).toHaveBeenCalled();
    assist.submit(assist.listPending()[0]!.id, '123456');
    await flush();
    expect(endpoint.submitSmsCode).toHaveBeenCalledWith('123456');
    endpoint.emit('system.online');
    await startP;
    await endpoint.stop();
  });
});

it('keeps same-name challenge controls scoped to their incarnation and cancels before a resolved ticket can hit a retired SDK', async () => {
  const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
  const abort = new AbortController();
  const identity = { canonicalId: endpointKey, instanceId: 'account-instance', epoch: 1, incarnationId: 'execution-one' };
  const old = makeEndpoint(assist, 'en', { signal: abort.signal, endpointIdentity: identity });
  const replacement = makeEndpoint(assist, 'en', { signal: new AbortController().signal, endpointIdentity: { ...identity, epoch: 2, incarnationId: 'execution-two' } });
  vi.mocked(old.login).mockImplementation(async () => { old.emit('system.login.slider', { url: 'https://example.com/slider' }); });
  const starting = old.start(abort.signal).catch(error => error);
  try {
    await vi.waitFor(() => expect(assist.listPending()).toHaveLength(1));
    const task = assist.listPending()[0]!;
    expect(task.endpointIdentity).toEqual(identity);
    expect(replacement.loginControl.pending()).toEqual([]);
    expect(replacement.loginControl.submit(task.id, 'wrong-epoch')).toBe(false);
    expect(old.loginControl.pending()).toHaveLength(1);
    expect(old.loginControl.submit(task.id, 'ticket')).toBe(true);
    abort.abort(new Error('account retired'));
    await starting;
    await flush();
    expect(old.submitSlider).not.toHaveBeenCalled();
    expect(assist.listPending()).toEqual([]);
    old.emit('system.login.slider', { url: 'https://example.com/late' });
    await flush();
    expect(assist.listPending()).toEqual([]);
  } finally { abort.abort(); await starting; await old.stop(); await replacement.stop(); assist.dispose(); }
});
