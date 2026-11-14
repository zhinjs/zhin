import { icqqFixture } from './fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import { LoginAssist, LoginSubmissionError, withoutLoginMedia, type LoginChallenge, type LoginFlowSnapshot } from '@zhin.js/core';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import { resolveIcqqConfig } from '../src/protocol.js';
import { createIcqqTestPorts } from './_icqq-mock.js';
import { ICQQ_LOGIN_ERROR_TABLE, mapIcqqLoginError, sanitizeIcqqLoginMessage } from '../src/icqq-login-errors.js';
import { authDescriptor, icqqAuthHelperScript, sliderCaptchaQuery } from '../src/icqq-login-descriptors.js';
import { icqqLinkHost, icqqSliderSubmission, isNtCaptcha } from '../src/icqq-login-assist.js';
import { isBridgedIcqqSdkLogger, redactIcqqLogText, redactingIcqqLogger } from '../src/sdk-logger.js';
import { pickIcqqCodeTarget } from '../commands/icqq/login/definition.js';
import type { IcqqLoginControl } from '../src/icqq-login-control.js';
import { icqqSystemEventLogLevel, loginChallengeLogLine } from '../src/endpoint.js';
import definition from '../adapters/icqq/index.js';

const endpointKey = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq');
const DEVICE = { guid: 'device-guid-secret-0123', qimei: 'qimei-secret', qimei36: 'qimei-secret', subappid: '537', platform: 'Android', brand: 'Xiaomi', model: 'MI 9', bssid: '', devInfo: 'Xiaomi MI 9', sysVersion: '30' };
const SLIDER_URL = 'https://ssl.captcha.qq.com/template/wireless_mqq_captcha.html?style=simple&aid=16&uin=10001&sid=abc&cap_cd=xyz';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type Setup = Awaited<ReturnType<typeof setup>>;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.useRealTimers();
});

async function setup(options: { locale?: 'zh-CN' | 'en'; autoReconnect?: boolean } = {}) {
  const assist = new LoginAssist(null, { defaultTimeoutMs: 300_000, verifyTimeoutMs: 0 });
  const events: LoginFlowSnapshot[] = [];
  assist.subscribe('endpoint.login.flow', (flow) => events.push(flow));
  const gateway: OutboundMessageService = { receive: vi.fn(async () => Object.freeze({ matched: true })), send: vi.fn(async () => 'sent') };
  const sideEvents = createIcqqTestPorts().sideEvents;
  const fixture = await icqqFixture({
    id: endpointKey, gateway, sideEvents, loginAssist: assist, locale: options.locale ?? 'zh-CN',
    config: resolveIcqqConfig({ id: '10001', autoReconnect: options.autoReconnect ?? false }),
  }, gateway, sideEvents);
  const client = fixture.endpoint;
  const flow = () => assist.getFlow('icqq', '10001')!;
  const active = (): { taskId: string; challenge: LoginChallenge } | undefined => {
    const snapshot = assist.getFlow('icqq', '10001');
    const step = snapshot?.steps.find((item) => item.taskId && item.taskId === snapshot.activeTaskId);
    return step?.challenge ? { taskId: step.taskId!, challenge: step.challenge } : undefined;
  };
  let starting: Promise<unknown> | undefined;
  const start = (raise: () => void) => {
    vi.mocked(client.login).mockImplementationOnce(async () => { raise(); });
    starting = fixture.start(new AbortController().signal).catch((error) => error);
  };
  cleanups.push(async () => { await fixture.stop(); await starting; assist.dispose(); });
  return { assist, fixture, client, flow, active, events, sideEvents, start };
}

const steps = (s: Setup) => s.flow().steps.map((step) => `${step.kind}:${step.status}`);

describe('icqq login flow (ADR 0058)', () => {
  it('declares interactive login with relogin and QR refresh', () => {
    expect(definition.login).toEqual({ mode: 'interactive', challenges: ['qrcode', 'slider', 'device', 'auth', 'sms'], relogin: true, refreshQr: true });
  });

  it('runs one flow per attempt: connect → challenge → verifying → online', async () => {
    const s = await setup();
    s.start(() => s.client.emit('system.login.qrcode', { image: Buffer.from('png') }));
    await flush();
    expect(s.flow().state).toBe('active');
    const { taskId, challenge } = s.active()!;
    expect(challenge).toMatchObject({
      kind: 'qrcode', title: '扫码登录',
      help: { steps: ['用手机 QQ 扫码', '在手机上确认登录', expect.any(String)] },
      media: { qrImage: expect.stringMatching(/^data:image\/png;base64,/), refreshable: true },
      actions: [{ id: 'confirm', variant: 'primary' }],
    });
    s.assist.submit(taskId, { action: 'confirm', values: {} });
    await flush();
    expect(s.client.login).toHaveBeenCalledTimes(2);
    s.client.emit('system.online');
    expect(s.flow().state).toBe('online');
    expect(steps(s)).toEqual(['connect:done', 'challenge:done', 'verifying:done']);
  });

  describe('qrcode', () => {
    function withQrApi(s: Setup, results: number[]) {
      const query = vi.fn(async () => ({ retcode: results.length > 1 ? results.shift()! : results[0]! }));
      const qrcodeLogin = vi.fn(async () => undefined);
      const fetchQrcode = vi.fn(async () => { s.client.emit('system.login.qrcode', { image: Buffer.from('new') }); });
      Object.assign(s.client, { queryQrcodeResult: query, qrcodeLogin, fetchQrcode });
      return { query, qrcodeLogin, fetchQrcode };
    }

    it('follows the scan: scanned is an info step, a confirmed scan continues by itself', async () => {
      vi.useFakeTimers();
      const s = await setup();
      const api = withQrApi(s, [48, 53, 53, 0]);
      s.start(() => s.client.emit('system.login.qrcode', { image: Buffer.from('png') }));
      await vi.advanceTimersByTimeAsync(2_000);
      expect(s.active()).toBeDefined();
      await vi.advanceTimersByTimeAsync(4_000);
      expect(s.flow().steps.filter((step) => step.kind === 'info').map((step) => step.title)).toEqual(['已扫码，请在手机上确认登录']);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(api.qrcodeLogin).toHaveBeenCalledTimes(1);
      expect(s.client.login).toHaveBeenCalledTimes(1);
      expect(s.active()).toBeUndefined();
      expect(steps(s)).toEqual(['connect:done', 'challenge:done', 'info:done', 'verifying:active']);
      s.client.emit('system.online');
      expect(s.flow().state).toBe('online');
    });

    it('"I confirmed" before scanning reports it and shows the same QR code again', async () => {
      const s = await setup();
      const api = withQrApi(s, [48]);
      Object.assign(s.client, { queryQrcodeResult: vi.fn(async () => ({ retcode: 48 })) });
      s.start(() => s.client.emit('system.login.qrcode', { image: Buffer.from('png') }));
      await flush();
      const first = s.active()!;
      const answer = await s.assist.submitAndWait(first.taskId, 'ok', { timeoutMs: 1_000 });
      expect(answer.outcome).toMatchObject({ result: 'rejected', message: '还没有扫码，请先用手机 QQ 扫码', next: 'retry_input' });
      await flush();
      expect(s.active()?.challenge.kind).toBe('qrcode');
      expect(s.active()?.taskId).not.toBe(first.taskId);
      expect(api.qrcodeLogin).not.toHaveBeenCalled();
    });

    it('replaces an expired QR code twice by itself, then waits for the person', async () => {
      vi.useFakeTimers();
      const s = await setup();
      const api = withQrApi(s, [17]);
      s.start(() => s.client.emit('system.login.qrcode', { image: Buffer.from('png') }));
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(api.fetchQrcode).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(api.fetchQrcode).toHaveBeenCalledTimes(2);
      expect(s.flow().state).toBe('expired');
      expect(s.flow().lastOutcome).toMatchObject({ result: 'expired', code: 'challenge_expired', next: 'refresh_challenge' });
      expect(s.active()).toBeUndefined();
      // Nothing logs in again on its own.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(s.client.login).toHaveBeenCalledTimes(1);
    });

    // The first start is still blocked on the QR challenge: exactly when the person needs the hooks.
    it('refreshChallenge asks the SDK for a new QR code in place while the first start waits; relogin starts a new attempt', async () => {
      const s = await setup();
      const api = withQrApi(s, [48]);
      s.start(() => s.client.emit('system.login.qrcode', { image: Buffer.from('png') }));
      await flush();
      expect(s.fixture.index.describe()[0]).toMatchObject({ phase: 'starting' });
      const hooks = s.fixture.index.loginControl(s.fixture.canonicalId)!;
      const before = s.active()!.taskId;
      await hooks.refreshChallenge!({});
      expect(api.fetchQrcode).toHaveBeenCalledTimes(1);
      expect(s.client.login).toHaveBeenCalledTimes(1);
      expect(s.active()?.taskId).not.toBe(before);
      expect(s.flow().steps.some((step) => step.kind === 'info' && step.title === '正在换一张二维码…')).toBe(true);

      const attempt = s.flow().attempt;
      vi.mocked(s.client.login).mockImplementationOnce(async () => { s.client.emit('system.login.qrcode', { image: Buffer.from('again') }); });
      await hooks.relogin!({});
      expect(s.client.login).toHaveBeenCalledTimes(2);
      expect(s.flow().attempt).toBe(attempt + 1);
      expect(s.active()?.challenge.kind).toBe('qrcode');
      // The restarted attempt completes the still-pending first start.
      s.client.emit('system.online');
      await flush();
      expect(s.flow().state).toBe('online');
      await vi.waitFor(() => expect(s.fixture.index.describe()[0]!.phase).not.toBe('starting'));
    });

    it('refuses the hooks once the account was stopped', async () => {
      const s = await setup();
      s.start(() => s.client.emit('system.login.qrcode', { image: Buffer.from('png') }));
      await flush();
      const hooks = s.fixture.index.loginControl(s.fixture.canonicalId)!;
      await s.fixture.stop();
      await expect(hooks.relogin!({})).rejects.toBeDefined();
      await expect(hooks.refreshChallenge!({})).rejects.toBeDefined();
      expect(s.client.login).toHaveBeenCalledTimes(1);
    });

    it('refreshChallenge without a QR challenge logs in again', async () => {
      const s = await setup();
      s.start(() => s.client.emit('system.login.slider', { url: SLIDER_URL }));
      await flush();
      vi.mocked(s.client.login).mockImplementationOnce(async () => undefined);
      await s.fixture.index.loginControl(s.fixture.canonicalId)!.refreshChallenge!({});
      expect(s.client.login).toHaveBeenCalledTimes(2);
    });
  });

  describe('slider', () => {
    it('offers the hosted captcha helper, a link and the manual fallback', async () => {
      const s = await setup();
      s.start(() => s.client.emit('system.login.slider', { url: SLIDER_URL }));
      await flush();
      const { challenge } = s.active()!;
      expect(challenge).toMatchObject({
        kind: 'slider',
        media: { captcha: { provider: 'tencent', query: new URL(SLIDER_URL).search.slice(1) } },
        input: { kind: 'ticket', extract: 'ticket-json-or-url' },
        blocks: [{ kind: 'link', id: 'slider-link', url: SLIDER_URL }],
      });
      expect(challenge.help?.steps?.[0]).toMatchObject({ blockId: 'slider-link', doneWhen: 'opened' });
      expect(challenge.help?.steps?.map((step) => (typeof step === 'string' ? step : step.text)).join('\n')).toContain('cap_union_new_verify');
      // Old Consoles and chat commands still get the link.
      expect(s.assist.listPending()[0]!.payload.url).toBe(SLIDER_URL);
    });

    it('legacy wtlogin path submits the ticket alone, even from a pasted response JSON', async () => {
      const s = await setup();
      Object.assign(s.client, { sig: { nt_captcha: null } });
      s.start(() => s.client.emit('system.login.slider', { url: SLIDER_URL }));
      await flush();
      s.assist.submit(s.active()!.taskId, '{"errorCode":"0","ticket":"t03-legacy","randstr":"@rs"}');
      await flush();
      expect(s.client.submitSlider).toHaveBeenCalledWith('t03-legacy');
    });

    it('NT path submits ticket,randstr from the captcha helper', async () => {
      const s = await setup();
      Object.assign(s.client, { sig: { nt_captcha: { url: SLIDER_URL } } });
      s.start(() => s.client.emit('system.login.slider', { url: SLIDER_URL }));
      await flush();
      s.assist.submit(s.active()!.taskId, { action: 'submit', values: { ticket: 't03-nt,@randstr' } });
      await flush();
      expect(s.client.submitSlider).toHaveBeenCalledWith('t03-nt,@randstr');
      expect(steps(s).at(-1)).toBe('verifying:active');
    });

    it('NT path without randstr stays on the slider and explains why', async () => {
      const s = await setup();
      Object.assign(s.client, { sig: { nt_captcha: { url: SLIDER_URL } } });
      s.start(() => s.client.emit('system.login.slider', { url: SLIDER_URL }));
      await flush();
      const result = await s.assist.submitAndWait(s.active()!.taskId, 'only-ticket', { timeoutMs: 1_000 });
      expect(result.outcome).toMatchObject({ result: 'rejected', code: 'code_invalid', next: 'retry_input' });
      expect(result.outcome?.message).toContain('randstr');
      expect(result.outcome?.message).not.toContain('only-ticket');
      expect(s.client.submitSlider).not.toHaveBeenCalled();
      expect(s.active()?.challenge.kind).toBe('slider');
    });

    it('detects the NT captcha by the SDK rule (truthy sig.nt_captcha)', () => {
      expect(isNtCaptcha({ sig: { nt_captcha: { url: SLIDER_URL } } })).toBe(true);
      // The URL never flips a true SDK state to legacy.
      expect(isNtCaptcha({ sig: { nt_captcha: { url: 'https://other.example/x' } } })).toBe(true);
      expect(isNtCaptcha({ sig: { nt_captcha: null } })).toBe(false);
      expect(isNtCaptcha({})).toBe(false);
      expect(icqqSliderSubmission({ ticket: 't', randstr: 'r' }, true)).toBe('t,r');
      expect(icqqSliderSubmission({ ticket: 't', randstr: 'r' }, false)).toBe('t');
      expect(sliderCaptchaQuery('javascript:alert(1)')).toBeUndefined();
    });

    it('a wrong NT ticket logs in again for a fresh slider (the captcha was consumed), still in NT format', async () => {
      const s = await setup({ autoReconnect: true });
      const sig: { nt_captcha: { url: string } | null } = { nt_captcha: { url: SLIDER_URL } };
      Object.assign(s.client, { sig });
      // Like the SDK: submitting clears the NT captcha state; a new login raises a new NT slider.
      vi.mocked(s.client.submitSlider).mockImplementation(async () => { sig.nt_captcha = null; });
      const fresh = `${SLIDER_URL}&fresh=1`;
      s.start(() => s.client.emit('system.login.slider', { url: SLIDER_URL }));
      await flush();
      s.assist.submit(s.active()!.taskId, { action: 'submit', values: { ticket: 't1,r1' } });
      await flush();
      expect(s.client.submitSlider).toHaveBeenLastCalledWith('t1,r1');
      vi.mocked(s.client.login).mockImplementationOnce(async () => {
        sig.nt_captcha = { url: fresh };
        s.client.emit('system.login.slider', { url: fresh });
      });
      s.client.emit('system.login.error', { code: 140022016, message: '[登录失败]ticket无效' });
      await flush();
      expect(s.client.login).toHaveBeenCalledTimes(2);
      expect(s.flow().steps.some((step) => step.outcome?.code === 'code_invalid')).toBe(true);
      expect(s.active()?.challenge.blocks?.[0]).toMatchObject({ url: fresh });
      s.assist.submit(s.active()!.taskId, { action: 'submit', values: { ticket: 't2,r2' } });
      await flush();
      expect(vi.mocked(s.client.submitSlider).mock.calls).toEqual([['t1,r1'], ['t2,r2']]);
    });

    it('a wrong NT ticket fails the attempt when the fresh login cannot start', async () => {
      const s = await setup();
      Object.assign(s.client, { sig: { nt_captcha: { url: SLIDER_URL } } });
      s.start(() => s.client.emit('system.login.slider', { url: SLIDER_URL }));
      await flush();
      s.assist.submit(s.active()!.taskId, { action: 'submit', values: { ticket: 't1,r1' } });
      await flush();
      vi.mocked(s.client.login).mockRejectedValueOnce(new Error('socket closed'));
      s.client.emit('system.login.error', { code: 140022016, message: '[登录失败]ticket无效' });
      await flush(); await flush();
      expect(s.flow()).toMatchObject({ state: 'failed', lastOutcome: { code: 'code_invalid', next: 'relogin' } });
    });

    it('a wrong legacy ticket (login.error) stays on the slider, still in legacy format', async () => {
      const s = await setup({ autoReconnect: true });
      s.start(() => s.client.emit('system.login.slider', { url: SLIDER_URL }));
      await flush();
      s.assist.submit(s.active()!.taskId, 'bad-ticket');
      await flush();
      s.client.emit('system.login.error', { code: 140022016, message: '[登录失败]ticket无效' });
      await flush();
      expect(s.flow().state).toBe('active');
      expect(s.flow().lastOutcome).toMatchObject({ result: 'rejected', code: 'code_invalid', next: 'retry_input' });
      expect(s.active()?.challenge.kind).toBe('slider');
      s.assist.submit(s.active()!.taskId, '{"ticket":"t2","randstr":"r2"}');
      await flush();
      expect(s.client.submitSlider).toHaveBeenLastCalledWith('t2');
    });
  });

  describe('device lock and SMS', () => {
    it('continue logs in again without sending an SMS', async () => {
      const s = await setup();
      s.start(() => s.client.emit('system.login.device', { url: 'https://accounts.qq.com/safe/verify?sig=1', phone: '138****0000' }));
      await flush();
      const { taskId, challenge } = s.active()!;
      expect(challenge).toMatchObject({
        kind: 'device',
        actions: [{ id: 'continue', label: '我已在手机完成验证', variant: 'primary' }, { id: 'sms', label: '改用短信验证码' }],
        blocks: [{ kind: 'link', id: 'verify-link', showQr: true }],
      });
      s.assist.submit(taskId, { action: 'continue', values: {} });
      await flush();
      expect(s.client.login).toHaveBeenCalledTimes(2);
      expect(s.client.sendSmsCode).not.toHaveBeenCalled();
    });

    it('offers no SMS when the SDK reports no phone', async () => {
      const s = await setup();
      s.start(() => s.client.emit('system.login.device', { url: 'https://accounts.qq.com/safe/verify?sig=1', phone: '' }));
      await flush();
      expect(s.active()!.challenge.actions.map((action) => action.id)).toEqual(['continue']);
    });

    it('sms → code challenge, validates the code, resend honours the cooldown', async () => {
      vi.useFakeTimers();
      const s = await setup();
      s.start(() => s.client.emit('system.login.device', { url: 'https://accounts.qq.com/safe/verify?sig=1', phone: '138****0000' }));
      await vi.advanceTimersByTimeAsync(0);
      s.assist.submit(s.active()!.taskId, { action: 'sms', values: {} });
      await vi.advanceTimersByTimeAsync(0);
      expect(s.client.sendSmsCode).toHaveBeenCalledTimes(1);
      const sms = s.active()!;
      expect(sms.challenge).toMatchObject({
        kind: 'sms',
        input: { kind: 'code', length: 6, pattern: '^\\d{6}$' },
        actions: [{ id: 'submit', requiresInput: true }, { id: 'resend', cooldownMs: 60_000 }],
      });
      expect(sms.challenge.help?.short).toContain('138****0000');
      // The device step counted as accepted.
      expect(s.flow().steps.find((step) => step.kind === 'verifying')?.outcome).toEqual({ result: 'accepted' });

      expect(() => s.assist.submit(sms.taskId, '12ab')).toThrow(LoginSubmissionError);
      expect(s.active()?.taskId).toBe(sms.taskId);

      s.assist.submit(sms.taskId, { action: 'resend', values: {} });
      await vi.advanceTimersByTimeAsync(0);
      expect(s.client.sendSmsCode).toHaveBeenCalledTimes(1);
      expect(s.flow().lastOutcome).toMatchObject({ result: 'rejected', code: 'rate_limited', next: 'wait' });
      expect(s.flow().lastOutcome?.retryAfterMs).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(60_000);
      s.assist.submit(s.active()!.taskId, { action: 'resend', values: {} });
      await vi.advanceTimersByTimeAsync(0);
      expect(s.client.sendSmsCode).toHaveBeenCalledTimes(2);
      expect(s.flow().steps.some((step) => step.kind === 'info' && step.title === '已重新发送短信验证码')).toBe(true);

      s.assist.submit(s.active()!.taskId, ' 654321 ');
      await vi.advanceTimersByTimeAsync(0);
      expect(s.client.submitSmsCode).toHaveBeenCalledWith('654321');
    });

    it('a wrong SMS code (login.error 163) re-opens the SMS challenge', async () => {
      const s = await setup({ autoReconnect: true });
      s.start(() => s.client.emit('system.login.device', { url: 'https://accounts.qq.com/safe/verify?sig=1', phone: '138****0000' }));
      await flush();
      s.assist.submit(s.active()!.taskId, { action: 'sms', values: {} });
      await flush();
      s.assist.submit(s.active()!.taskId, '111111');
      await flush();
      s.client.emit('system.login.error', { code: 163, message: '验证码错误' });
      await flush();
      expect(s.active()?.challenge.kind).toBe('sms');
      expect(s.flow().lastOutcome).toMatchObject({ result: 'rejected', code: 'code_invalid', message: '验证码错误' });
      expect(s.client.sendSmsCode).toHaveBeenCalledTimes(1);
    });

    it.each([
      [new Error('发送短信过于频繁'), 'rate_limited', 'wait'],
      [new Error('socket closed'), 'unknown', 'retry_input'],
    ] as const)('an SMS send failure (%s) is reported and stays on the device lock', async (error, code, next) => {
      const s = await setup();
      vi.mocked(s.client.sendSmsCode).mockRejectedValueOnce(error);
      s.start(() => s.client.emit('system.login.device', { url: 'https://accounts.qq.com/safe/verify?sig=1', phone: '138****0000' }));
      await flush();
      const result = await s.assist.submitAndWait(s.active()!.taskId, { action: 'sms', values: {} }, { timeoutMs: 1_000 });
      expect(result.outcome).toMatchObject({ result: 'rejected', code, next });
      expect(result.outcome?.message).toContain(error.message);
      await flush();
      expect(s.active()?.challenge.kind).toBe('device');
    });
  });

  describe('identity verification (auth)', () => {
    it('guides with the device JSON, the verification link and the helper script', async () => {
      const s = await setup();
      s.start(() => s.client.emit('system.login.auth', { url: 'https://accounts.qq.com/login/attack?sig=abc', device: DEVICE }));
      await flush();
      const { taskId, challenge } = s.active()!;
      expect(challenge.help?.warning).toBe('不要把设备 JSON 粘贴到其他网站或发给他人');
      expect(challenge.help?.steps).toEqual([
        { text: '复制设备 JSON', blockId: 'device-json', doneWhen: 'copied' },
        { text: '打开验证链接，进入发送验证码的页面', blockId: 'verify-link', doneWhen: 'opened' },
        expect.objectContaining({ blockId: 'helper-script', doneWhen: 'copied' }),
        { text: '完成后点「已完成，继续登录」', doneWhen: 'manual' },
      ]);
      const [json, link, script] = challenge.blocks!;
      expect(json).toMatchObject({ kind: 'copy', id: 'device-json', format: 'json', sensitive: true, thenOpen: 'verify-link' });
      expect(JSON.parse((json as { content: string }).content)).toEqual(DEVICE);
      expect(link).toMatchObject({ kind: 'link', id: 'verify-link', showQr: true });
      expect(script).toMatchObject({ kind: 'copy', id: 'helper-script', format: 'script', collapsed: true, bookmarklet: true });
      expect((script as { content: string }).content).not.toContain(DEVICE.guid);
      expect(challenge.actions).toEqual([expect.objectContaining({ id: 'continue', label: '已完成，继续登录', variant: 'primary' })]);

      // Device data never leaves the live challenge: not in event-safe snapshots, side events or the ended step.
      expect(JSON.stringify(s.events.map(withoutLoginMedia))).not.toContain(DEVICE.guid);
      s.assist.submit(taskId, { action: 'continue', values: {} });
      await flush();
      expect(s.client.login).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(s.flow())).not.toContain(DEVICE.guid);
    });

    it('without device information shows only the link', () => {
      const descriptor = authDescriptor({ url: 'https://accounts.qq.com/login/attack?x=1' });
      expect(descriptor.blocks?.map((block) => block.kind)).toEqual(['link']);
      expect(descriptor.help?.warning).toBeUndefined();
    });

    describe('helper script', () => {
      const run = (hostname: string, pathname: string, answer: string | null, state: Record<string, unknown> | undefined = {}) => {
        const alerts: string[] = [];
        const window: Record<string, unknown> = { __INITIAL_STATE__: state };
        runInNewContext(icqqAuthHelperScript('zh-CN'), {
          location: { hostname, pathname }, window, prompt: () => answer, alert: (text: string) => alerts.push(text),
        });
        return { alerts, state: window.__INITIAL_STATE__ as Record<string, unknown> | undefined };
      };

      it('is static text with a host guard and no submission', () => {
        const script = icqqAuthHelperScript('zh-CN');
        expect(script).toBe(icqqAuthHelperScript('zh-CN'));
        expect(script).toContain("location.hostname !== \"accounts.qq.com\"");
        expect(script).toContain("location.pathname !== \"/login/attack\"");
        expect(script).not.toMatch(/fetch\(|XMLHttpRequest|\.submit\(|\.click\(|sendBeacon/u);
        // A bookmarklet is one line: no line comments.
        expect(script.split('\n').some((line) => line.trim().startsWith('//'))).toBe(false);
        expect(icqqAuthHelperScript('en')).toContain('Paste the device JSON');
      });

      it('runs only on accounts.qq.com/login/attack', () => {
        const other = run('evil.example', '/login/attack', JSON.stringify(DEVICE));
        expect(other.state).toEqual({});
        expect(other.alerts[0]).toContain('accounts.qq.com/login/attack');
        expect(run('accounts.qq.com', '/other', JSON.stringify(DEVICE)).state).toEqual({});
      });

      it('validates the pasted JSON and sets deviceInfo', () => {
        expect(run('accounts.qq.com', '/login/attack', '{oops').alerts[0]).toContain('格式不正确');
        expect(run('accounts.qq.com', '/login/attack', '{"qimei":"x"}').alerts[0]).toContain('guid');
        expect(run('accounts.qq.com', '/login/attack', null).alerts).toEqual([]);
        expect(run('accounts.qq.com', '/login/attack', JSON.stringify(DEVICE), null as never).alerts[0]).toContain('刷新');
        const ok = run('accounts.qq.com', '/login/attack', JSON.stringify(DEVICE));
        expect(ok.state?.deviceInfo).toEqual(DEVICE);
        expect(ok.alerts[0]).toContain('设备信息已写入');
      });
    });
  });

  describe('login errors', () => {
    it.each([
      [{ code: 1, message: '密码错误' }, 'credential_invalid', 'relogin'],
      [{ code: 140022013, message: '[登录失败]账号或密码错误' }, 'credential_invalid', 'relogin'],
      [{ code: 163, message: '验证码错误' }, 'code_invalid', 'retry_input'],
      [{ code: 150022026, message: 'x' }, 'code_invalid', 'retry_input'],
      [{ code: 162, message: '短信发送次数过多' }, 'rate_limited', 'wait'],
      [{ code: 150022022, message: '' }, 'rate_limited', 'wait'],
      [{ code: 237, message: '[登陆失败](237)当前QQ登录频繁，暂时被限制登录' }, 'rate_limited', 'wait'],
      [{ code: 40, message: '账号被冻结' }, 'risk_blocked', 'none'],
      [{ code: 235, message: '[登陆失败](235)当前设备信息被拉黑，建议删除"/home/bot/data/device.json"后重新登录！' }, 'risk_blocked', 'none'],
      [{ code: 140022014, message: '' }, 'challenge_expired', 'relogin'],
      [{ code: 9999, message: '[登录失败]ticket已过期' }, 'challenge_expired', 'relogin'],
      [{ code: 9999, message: 'ticket expired' }, 'challenge_expired', 'relogin'],
      [{ code: 9999, message: 'ticket无效' }, 'code_invalid', 'retry_input'],
      [{ code: 123456, message: 'token不兼容' }, 'credential_invalid', 'none'],
      [{ code: 140022003, message: '' }, 'network', 'wait'],
      [{ code: 9, message: '[登陆失败]未知错误' }, 'unknown', 'relogin'],
      [{ code: 2, message: '[登陆失败]未知格式的验证码' }, 'unknown', 'relogin'],
      [{ code: 999, message: '服务器繁忙' }, 'network', 'wait'],
      [{}, 'unknown', 'relogin'],
    ] as const)('maps %j → %s / %s', (event, code, next) => {
      expect(mapIcqqLoginError(event)).toMatchObject({ code, next });
    });

    it('keeps only a sanitized platform message', () => {
      const mapped = mapIcqqLoginError({ code: 235, message: '[登陆失败](235)\n当前设备信息被拉黑，建议删除"/home/bot/data/device.json"后重新登录！' });
      expect(mapped.message).not.toContain('/home/bot');
      expect(mapped.message).not.toContain('\n');
      expect(sanitizeIcqqLoginMessage(`x${'y'.repeat(400)}`).length).toBeLessThanOrEqual(200);
      expect(mapIcqqLoginError({ code: 1 }, 'en').message).toBe('The password or login credential is not valid');
      // A token incompatible with the protocol is not fixed by logging in again: say what does.
      expect(mapIcqqLoginError({ code: 123456, message: 'token不兼容' }, 'zh-CN', '10001').message)
        .toBe('保存的登录凭据（token 文件）与当前协议不兼容。请停止账号，删除数据目录中的 10001_*_token 文件后再登录');
      for (const rule of ICQQ_LOGIN_ERROR_TABLE) expect(rule.codes?.length || rule.pattern).toBeTruthy();
    });

    it('a verification failure ends the flow and waits for the person (no automatic relogin)', async () => {
      vi.useFakeTimers();
      const s = await setup({ autoReconnect: true });
      s.start(() => s.client.emit('system.login.device', { url: 'https://accounts.qq.com/safe/verify?sig=1', phone: '' }));
      await vi.advanceTimersByTimeAsync(0);
      s.assist.submit(s.active()!.taskId, { action: 'continue', values: {} });
      vi.mocked(s.client.login).mockImplementation(async () => undefined);
      await vi.advanceTimersByTimeAsync(0);
      s.client.emit('system.login.error', { code: 9, message: '[登陆失败]未知错误' });
      expect(s.flow().state).toBe('failed');
      expect(s.flow().lastOutcome).toMatchObject({ result: 'failed', code: 'unknown', next: 'relogin' });
      await vi.advanceTimersByTimeAsync(600_000);
      expect(s.client.login).toHaveBeenCalledTimes(2);
    });

    it('a credential error never retries on its own', async () => {
      vi.useFakeTimers();
      const s = await setup({ autoReconnect: true });
      s.start(() => s.client.emit('system.login.error', { code: 1, message: '密码错误' }));
      await vi.advanceTimersByTimeAsync(600_000);
      expect(s.client.login).toHaveBeenCalledTimes(1);
      expect(s.flow().lastOutcome).toMatchObject({ result: 'failed', code: 'credential_invalid', next: 'relogin' });
    });

    it('a network failure keeps the automatic backoff, each retry on the timeline', async () => {
      vi.useFakeTimers();
      const s = await setup({ autoReconnect: true });
      vi.mocked(s.client.login).mockImplementation(async () => { s.client.emit('system.login.error', { code: 140022003, message: '' }); });
      s.start(() => s.client.emit('system.login.error', { code: 140022003, message: '' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(s.flow().state).toBe('active');
      expect(s.flow().lastOutcome).toMatchObject({ result: 'rejected', code: 'network', next: 'wait' });
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(s.client.login).toHaveBeenCalledTimes(3);
      const info = s.flow().steps.filter((step) => step.kind === 'info').map((step) => step.title);
      expect(info).toEqual([
        '网络或服务器出错，5 秒后自动重新登录（第 1 次）',
        '网络或服务器出错，10 秒后自动重新登录（第 2 次）',
        '网络或服务器出错，20 秒后自动重新登录（第 3 次）',
      ]);
      expect(s.flow().attempt).toBe(1);
    });

    it('being kicked off relogs in with backoff on a new flow', async () => {
      vi.useFakeTimers();
      const s = await setup({ autoReconnect: true });
      s.start(() => s.client.emit('system.online'));
      await vi.advanceTimersByTimeAsync(0);
      expect(s.flow().state).toBe('online');
      s.client.emit('system.offline.kickoff', { message: 'kicked' });
      expect(s.flow().state).toBe('active');
      expect(s.flow().steps[0]).toMatchObject({ kind: 'info', title: '账号被踢下线，5 秒后自动重新登录（第 1 次）' });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(s.client.login).toHaveBeenCalledTimes(2);
      expect(s.flow().state).toBe('online');
    });
  });

  describe('logs', () => {
    it('show only the challenge kind and the link host, never the link (it carries a sid)', () => {
      expect(loginChallengeLogLine('slider', { url: SLIDER_URL })).toEqual({ kind: 'slider', host: 'ssl.captcha.qq.com' });
      expect(loginChallengeLogLine('auth', { url: 'https://accounts.qq.com/login/attack?sig=abc', device: DEVICE }))
        .toEqual({ kind: 'auth', host: 'accounts.qq.com' });
      expect(loginChallengeLogLine('qrcode', { image: 'data:image/png;base64,AAAA' })).toEqual({ kind: 'qrcode' });
      expect(icqqLinkHost('javascript:alert(1)')).toBeUndefined();
      expect(icqqLinkHost('not a url')).toBeUndefined();
    });

    it('the driver logs the host of a challenge link, not its query', async () => {
      const s = await setup();
      const info = vi.fn();
      // Reach the driver's logger through the adapter logger it was given.
      const { getAdapterLogger } = await import('@zhin.js/logger');
      const logger = getAdapterLogger('icqq', '10001');
      const spy = vi.spyOn(logger, 'info').mockImplementation(info);
      const warn = vi.spyOn(logger, 'warn').mockImplementation(info);
      s.start(() => s.client.emit('system.login.slider', { url: SLIDER_URL }));
      await flush();
      expect(s.active()?.challenge.kind).toBe('slider');
      const lines = info.mock.calls.map((call) => String(call[0])).join('\n');
      expect(lines).toContain('ssl.captcha.qq.com');
      expect(lines).not.toContain('sid=abc');
      expect(lines).not.toContain('cap_cd');
      spy.mockRestore(); warn.mockRestore();
    });
  });

  describe('system event log levels (#1250)', () => {
    it('grades system events by meaning: online and challenges are info, only failures warn', () => {
      expect(icqqSystemEventLogLevel('online')).toBe('info');
      for (const step of ['qrcode', 'device', 'slider', 'auth']) expect(icqqSystemEventLogLevel(`login.${step}`)).toBe('info');
      expect(icqqSystemEventLogLevel('login.error')).toBe('warn');
      for (const type of ['offline', 'offline.network', 'offline.kickoff']) expect(icqqSystemEventLogLevel(type)).toBe('warn');
    });

    it('a routine login writes no warning', async () => {
      const s = await setup();
      const { getAdapterLogger } = await import('@zhin.js/logger');
      const logger = getAdapterLogger('icqq', '10001');
      const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      try {
        s.start(() => {
          s.client.emit('system.login.slider', { url: SLIDER_URL });
          s.client.emit('system.online');
        });
        await vi.waitFor(() => expect(s.flow()?.state).toBe('online'));
        await flush();
        const warnings = warn.mock.calls.map((call) => String(call[0])).join('\n');
        expect(warnings).not.toContain('system.online');
        expect(warnings).not.toContain('system.login');
        const infos = info.mock.calls.map((call) => String(call[0])).join('\n');
        expect(infos).toContain('system.online');
        expect(infos).toContain('system.login.slider');
      } finally { info.mockRestore(); warn.mockRestore(); }
    });
  });

  describe('review fixes', () => {
    it('system.receive side events of login challenges carry only kind and host', async () => {
      const s = await setup();
      s.start(() => s.client.emit('system.online'));
      await vi.waitFor(() => expect(s.flow()?.state).toBe('online'));
      await flush();
      // Side events are admitted once the Endpoint is open.
      s.fixture.open();
      s.client.emit('system.login.device', { url: 'https://accounts.qq.com/safe/verify?sig=SECRETSIG', phone: '138****0000' });
      s.client.emit('system.login.slider', { url: 'https://ssl.captcha.qq.com/x?sid=SECRETSID' });
      s.client.emit('system.login.auth', { url: 'https://accounts.qq.com/login/attack?sig=AUTHSIG', device: DEVICE });
      s.client.emit('system.login.qrcode', { image: Buffer.from('qr-secret-image') });
      s.client.emit('system.login.error', { code: 235, message: '设备被拉黑，建议删除"/home/bot/data/device.json"' });
      await vi.waitFor(() => expect(vi.mocked(s.sideEvents.receiveSystem).mock.calls.length).toBeGreaterThanOrEqual(5));
      const sent = JSON.stringify(vi.mocked(s.sideEvents.receiveSystem).mock.calls);
      for (const secret of ['SECRETSIG', 'SECRETSID', 'AUTHSIG', '138****0000', DEVICE.guid, 'cXItc2VjcmV0', '/home/bot']) {
        expect(sent).not.toContain(secret);
      }
      expect(sent).toContain('accounts.qq.com');
      expect(sent).toContain('ssl.captcha.qq.com');
    });

    it('the SDK logger is wrapped: links lose their query, phones are masked', () => {
      expect(redactIcqqLogText('请访问以下地址完成滑动：https://ssl.captcha.qq.com/x.html?aid=1&sid=SECRET#frag 继续'))
        .toBe('请访问以下地址完成滑动：https://ssl.captcha.qq.com/x.html?… 继续');
      expect(redactIcqqLogText('密保手机号：138****0000')).toBe('密保手机号：***');
      expect(redactIcqqLogText('phone 13800138000 / +86 13800138000')).toBe('phone *** / ***');
      expect(redactIcqqLogText('uin 10001 group 123456789')).toBe('uin 10001 group 123456789');
      const original = { level: 'info' as unknown, trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), mark: vi.fn() };
      const wrapped = redactingIcqqLogger(original);
      wrapped.mark('登录保护验证URL：https://accounts.qq.com/safe/verify?sig=S', 42);
      expect(original.mark).toHaveBeenCalledWith('登录保护验证URL：https://accounts.qq.com/safe/verify?…', 42);
      wrapped.level = 'warn';
      expect(original.level).toBe('warn');
      expect(redactingIcqqLogger(wrapped)).toBe(wrapped);
    });

    it('the Endpoint replaces the SDK logger with the redacting Zhin bridge (#1250)', async () => {
      const s = await setup();
      const client = s.client as unknown as { logger: { level: unknown; mark(...args: unknown[]): void; info(...args: unknown[]): void }; rawLog: { mark: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> } };
      expect(isBridgedIcqqSdkLogger(client.logger)).toBe(true);
      expect(client.logger.level).toBe('warn');
      client.logger.mark('收到滑动验证码，请访问以下地址完成滑动：https://ssl.captcha.qq.com/x?sid=LEAK');
      client.logger.info('recv from: [Group: g(1), Member: m(2)] secret chat');
      // Nothing reaches the SDK's own log4js logger any more.
      expect(client.rawLog.mark).not.toHaveBeenCalled();
      expect(client.rawLog.info).not.toHaveBeenCalled();
    });

    it('fails the attempt when the automatic relogin is exhausted', async () => {
      vi.useFakeTimers();
      const s = await setup({ autoReconnect: true });
      vi.mocked(s.client.login).mockImplementation(async () => { s.client.emit('system.login.error', { code: 140022003, message: '' }); });
      s.start(() => s.client.emit('system.login.error', { code: 140022003, message: '' }));
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(s.client.login).toHaveBeenCalledTimes(9);
      expect(s.flow()).toMatchObject({ state: 'failed', lastOutcome: { result: 'failed', code: 'network', next: 'relogin' } });
      expect(s.flow().lastOutcome?.message).toContain('8');
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(s.client.login).toHaveBeenCalledTimes(9);
    });

    it('turns a failed QR login query (internal.error.qrcode) into an outcome', async () => {
      const s = await setup();
      Object.assign(s.client, { queryQrcodeResult: vi.fn(async () => ({ retcode: 0 })), qrcodeLogin: vi.fn(async () => undefined), fetchQrcode: vi.fn() });
      s.start(() => s.client.emit('system.login.qrcode', { image: Buffer.from('png') }));
      await flush();
      s.assist.submit(s.active()!.taskId, 'ok');
      await flush();
      expect(steps(s).at(-1)).toBe('verifying:active');
      s.client.emit('internal.error.qrcode', 48, '二维码尚未扫描');
      expect(s.flow().lastOutcome).toMatchObject({ result: 'rejected', message: '二维码尚未扫描', next: 'retry_input' });
      expect(s.active()?.challenge.kind).toBe('qrcode');
      // While a QR challenge is shown, the SDK's own errors are ignored.
      s.client.emit('internal.error.qrcode', 0, 'x');
      expect(s.flow().lastOutcome?.message).toBe('二维码尚未扫描');
      s.assist.submit(s.active()!.taskId, 'ok');
      await flush();
      s.client.emit('internal.error.qrcode', 17, '二维码超时，请重新获取');
      expect(s.flow().lastOutcome).toMatchObject({ result: 'expired', code: 'challenge_expired', next: 'refresh_challenge' });
    });

    it('login hooks do not wait for a hanging SDK call once their signal aborts', async () => {
      const s = await setup();
      s.start(() => s.client.emit('system.login.qrcode', { image: Buffer.from('png') }));
      await flush();
      vi.mocked(s.client.login).mockImplementationOnce(() => new Promise(() => undefined));
      const controller = new AbortController();
      const relogin = s.fixture.index.loginControl(s.fixture.canonicalId)!.relogin!({ signal: controller.signal });
      controller.abort(new Error('caller gone'));
      await expect(relogin).rejects.toThrow('caller gone');
    });

    it('a plain "sms" string still asks for an SMS on the device lock (released Consoles, stdin)', async () => {
      const s = await setup();
      s.start(() => s.client.emit('system.login.device', { url: 'https://accounts.qq.com/safe/verify?sig=1', phone: '138****0000' }));
      await flush();
      s.assist.submit(s.assist.listPending()[0]!.id, 'sms');
      await flush();
      expect(s.client.sendSmsCode).toHaveBeenCalledTimes(1);
      expect(s.active()?.challenge.kind).toBe('sms');
    });

    it('keeps the SMS cooldown across a relogin', async () => {
      const s = await setup();
      s.start(() => s.client.emit('system.login.device', { url: 'https://accounts.qq.com/safe/verify?sig=1', phone: '138****0000' }));
      await flush();
      s.assist.submit(s.active()!.taskId, { action: 'sms', values: {} });
      await flush();
      vi.mocked(s.client.login).mockImplementationOnce(async () => {
        s.client.emit('system.login.device', { url: 'https://accounts.qq.com/safe/verify?sig=2', phone: '138****0000' });
      });
      await s.client.relogin();
      await flush();
      const result = await s.assist.submitAndWait(s.active()!.taskId, { action: 'sms', values: {} }, { timeoutMs: 1_000 });
      expect(result.outcome).toMatchObject({ result: 'rejected', code: 'rate_limited', next: 'wait' });
      expect(s.client.sendSmsCode).toHaveBeenCalledTimes(1);
    });

    it('the code command never echoes its arguments when the account is ambiguous', () => {
      const control = (id: string) => ({ endpointId: id } as unknown as IcqqLoginControl);
      const two = new Map([['10001', control('10001')], ['10002', control('10002')]]);
      const reply = pickIcqqCodeTarget(two, ['654321']);
      expect(reply.text).toContain('10001');
      expect(reply.text).not.toContain('654321');
      expect(pickIcqqCodeTarget(two, ['99999', 'ticket-secret']).text).not.toContain('ticket-secret');
      expect(pickIcqqCodeTarget(two, ['10002', '654321'])).toMatchObject({ control: { endpointId: '10002' }, value: '654321' });
      const one = new Map([['10001', control('10001')]]);
      expect(pickIcqqCodeTarget(one, ['654321'])).toMatchObject({ value: '654321' });
      expect(pickIcqqCodeTarget(one, ['10001', '654321'])).toMatchObject({ value: '654321' });
      expect(pickIcqqCodeTarget(new Map(), ['1']).text).toBe('ICQQ 适配器还没有启动');
    });
  });
});
