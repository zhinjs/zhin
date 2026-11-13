import { icqqFixture } from './fixture.js';
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

async function makeEndpoint(assist: LoginAssist, locale: 'zh-CN' | 'en' = 'zh-CN', lifetime: Pick<ConstructorParameters<typeof IcqqEndpoint>[0], 'signal' | 'endpointIdentity'> = {}, config = baseConfig) {
  const gateway: OutboundMessageService = {
    receive: vi.fn(async () => Object.freeze({ matched: true })),
    send: vi.fn(async () => 'sent'),
  };
  return await icqqFixture({
    id: endpointKey,
    gateway,
    config,
    sideEvents: createIcqqTestPorts().sideEvents,
    loginAssist: assist, locale, ...lifetime,
  }, gateway, createIcqqTestPorts().sideEvents);
}

describe('icqq LoginAssist wiring', () => {
  it('settles start when candidate activation is aborted', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = await makeEndpoint(assist);
    vi.mocked(endpoint.endpoint.login).mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const start = endpoint.start(controller.signal);
    controller.abort(new Error('candidate rolled back'));
    await expect(start).rejects.toThrow('candidate rolled back');
  });

  it('does not register after abort while pending system requests are loading', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = await makeEndpoint(assist);
    vi.mocked(endpoint.endpoint.login).mockImplementation(async () => {
      endpoint.endpoint.emit('system.online');
    });
    vi.mocked(endpoint.endpoint.getSystemMsg).mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const start = endpoint.start(controller.signal);
    await flush();
    controller.abort(new Error('candidate rolled back during request pull'));
    await expect(start).rejects.toThrow('candidate rolled back during request pull');
  });

  it.each(['zh-CN', 'en'] as const)('qrcode challenge uses project %s and waits for submit before login()', async locale => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = await makeEndpoint(assist, locale);
    let loginCalls = 0;
    vi.mocked(endpoint.endpoint.login).mockImplementation(async () => {
      loginCalls += 1;
      if (loginCalls === 1) {
        endpoint.endpoint.emit('system.login.qrcode', { image: Buffer.from('png') });
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
    endpoint.endpoint.emit('system.online');
    await startP;
    await endpoint.stop();
  });

  it('slider challenge submits ticket via submitSlider', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = await makeEndpoint(assist);
    vi.mocked(endpoint.endpoint.login).mockImplementation(async () => {
      endpoint.endpoint.emit('system.login.slider', { url: 'https://example.com/slider' });
    });

    const startP = endpoint.start(new AbortController().signal);
    await flush();
    expect(assist.listPending()[0]).toMatchObject({ type: 'slider' });
    assist.submit(assist.listPending()[0]!.id, 'ticket-abc');
    await flush();
    expect(endpoint.endpoint.submitSlider).toHaveBeenCalledWith('ticket-abc');
    endpoint.endpoint.emit('system.online');
    await startP;
    await endpoint.stop();
  });

  it('device challenge waits for the URL check: ok continues with login() and sends no SMS', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = await makeEndpoint(assist);
    vi.mocked(endpoint.endpoint.login).mockImplementationOnce(async () => {
      endpoint.endpoint.emit('system.login.device', { url: 'https://ex', phone: '138****' });
    });

    const startP = endpoint.start(new AbortController().signal);
    await flush();
    const [task] = assist.listPending();
    expect(task).toMatchObject({ type: 'device', payload: { url: 'https://ex' } });
    expect(String(task!.payload.message)).toContain('ok');
    expect(endpoint.endpoint.sendSmsCode).not.toHaveBeenCalled();
    assist.submit(task!.id, 'ok');
    await flush();
    expect(endpoint.endpoint.login).toHaveBeenCalledTimes(2);
    expect(endpoint.endpoint.submitSmsCode).not.toHaveBeenCalled();
    endpoint.endpoint.emit('system.online');
    await startP;
    await endpoint.stop();
  });

  it('device challenge sends an SMS only when asked, then submits the code', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = await makeEndpoint(assist);
    vi.mocked(endpoint.endpoint.login).mockImplementationOnce(async () => {
      endpoint.endpoint.emit('system.login.device', { url: 'https://ex', phone: '138****' });
    });

    const startP = endpoint.start(new AbortController().signal);
    await flush();
    assist.submit(assist.listPending()[0]!.id, { action: 'sms' });
    await flush();
    expect(endpoint.endpoint.sendSmsCode).toHaveBeenCalledTimes(1);
    const [smsTask] = assist.listPending();
    expect(smsTask).toMatchObject({ type: 'sms' });
    expect(String(smsTask!.payload.message)).toContain('138****');
    assist.submit(smsTask!.id, ' 123456 ');
    await flush();
    expect(endpoint.endpoint.submitSmsCode).toHaveBeenCalledWith('123456');
    endpoint.endpoint.emit('system.online');
    await startP;
    await endpoint.stop();
  });

  it('a failed SMS request asks again and still allows the URL check', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const endpoint = await makeEndpoint(assist);
    vi.mocked(endpoint.endpoint.login).mockImplementationOnce(async () => {
      endpoint.endpoint.emit('system.login.device', { url: 'https://ex' });
    });
    vi.mocked(endpoint.endpoint.sendSmsCode).mockRejectedValueOnce(new Error('too frequent'));

    const startP = endpoint.start(new AbortController().signal);
    await flush();
    assist.submit(assist.listPending()[0]!.id, 'sms');
    await flush();
    const [again] = assist.listPending();
    expect(again).toMatchObject({ type: 'device', payload: { url: 'https://ex' } });
    expect(String(again!.payload.message)).toContain('too frequent');
    assist.submit(again!.id, 'ok');
    await flush();
    expect(endpoint.endpoint.login).toHaveBeenCalledTimes(2);
    endpoint.endpoint.emit('system.online');
    await startP;
    await endpoint.stop();
  });

  it('never relogs in while a challenge waits for the operator, and retries with backoff once it goes unanswered', async () => {
    vi.useFakeTimers();
    try {
      const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
      const endpoint = await makeEndpoint(assist, 'zh-CN', {}, resolveIcqqConfig({ id: '10001', autoReconnect: true }));
      // The reported loop: a login error schedules a relogin; that relogin's login() returns while
      // a device lock waits, and the relogin used to schedule another one that replaced the lock.
      vi.mocked(endpoint.endpoint.login)
        .mockImplementationOnce(async () => { endpoint.endpoint.emit('system.login.error', { code: 9, message: '[登陆失败]未知错误' }); })
        .mockImplementation(async () => { endpoint.endpoint.emit('system.login.device', { url: 'https://ex' }); });

      const startP = endpoint.start(new AbortController().signal);
      startP.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(endpoint.endpoint.login).toHaveBeenCalledTimes(2);
      expect(assist.listPending()).toHaveLength(1);
      const [lock] = assist.listPending();

      // While the operator works on it, nothing replaces it.
      await vi.advanceTimersByTimeAsync(50_000);
      expect(endpoint.endpoint.login).toHaveBeenCalledTimes(2);
      expect(assist.listPending().map(task => task.id)).toEqual([lock!.id]);

      // Unanswered: the task expires, then one backoff relogin raises a fresh challenge.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(assist.listPending().map(task => task.id)).not.toContain(lock!.id);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(endpoint.endpoint.login).toHaveBeenCalledTimes(3);
      expect(assist.listPending()).toHaveLength(1);
      await endpoint.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

it('keeps same-name challenge controls scoped to their incarnation and cancels before a resolved ticket can hit a retired SDK', async () => {
  const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
  const abort = new AbortController();
  const identity = { canonicalId: endpointKey, instanceId: 'account-instance', epoch: 1, incarnationId: 'execution-one' };
  const old = await makeEndpoint(assist, 'en', { signal: abort.signal, endpointIdentity: identity });
  const replacement = await makeEndpoint(assist, 'en', { signal: new AbortController().signal, endpointIdentity: { ...identity, epoch: 2, incarnationId: 'execution-two' } });
  vi.mocked(old.endpoint.login).mockImplementation(async () => { old.endpoint.emit('system.login.slider', { url: 'https://example.com/slider' }); });
  const starting = old.start(abort.signal).catch(error => error);
  try {
    await vi.waitFor(() => expect(assist.listPending()).toHaveLength(1));
    const task = assist.listPending()[0]!;
    expect(task.endpointIdentity).toEqual(identity);
    expect(replacement.endpoint.loginControl.pending()).toEqual([]);
    expect(replacement.endpoint.loginControl.submit(task.id, 'wrong-epoch')).toBe(false);
    expect(old.endpoint.loginControl.pending()).toHaveLength(1);
    expect(old.endpoint.loginControl.submit(task.id, 'ticket')).toBe(true);
    abort.abort(new Error('account retired'));
    await starting;
    await flush();
    expect(old.endpoint.submitSlider).not.toHaveBeenCalled();
    expect(assist.listPending()).toEqual([]);
    old.endpoint.emit('system.login.slider', { url: 'https://example.com/late' });
    await flush();
    expect(assist.listPending()).toEqual([]);
  } finally { abort.abort(); await starting; await old.stop(); await replacement.stop(); assist.dispose(); }
});
