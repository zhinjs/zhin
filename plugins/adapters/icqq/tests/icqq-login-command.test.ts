import { afterEach, describe, expect, it, vi } from 'vitest';
import { rootPluginId } from 'zhin.js';
import { LoginAssist } from '@zhin.js/core';
import { loginAssistToken } from '@zhin.js/core/runtime';
import { projectLocaleToken } from 'zhin.js/i18n';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));
import definition from '../adapters/icqq/index.js';
import { IcqqEndpoint } from '../src/endpoint.js';
import statusCommand from '../commands/icqq/login/status/index.js';
import qrCommand from '../commands/icqq/login/qr/index.js';
import confirmCommand from '../commands/icqq/login/confirm/index.js';
import codeCommand from '../commands/icqq/login/code/index.js';
import retryCommand from '../commands/icqq/login/retry/index.js';
import { isIcqqLoginOperator } from '../commands/icqq/login/definition.js';

const fixtures: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(close => close())); });
async function fixture(type: 'qrcode' | 'slider' | 'device' | 'auth' = 'qrcode') {
  const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
  const submit = vi.spyOn(assist, 'submit');
  const runtime = await createAdapterHarness(definition, { id: '10001', autoReconnect: false }, { name: 'icqq',
    resources: new Map([[loginAssistToken.id, assist], [projectLocaleToken.id, 'zh-CN']]) });
  fixtures.push(async () => { await runtime.stop(); assist.dispose(); });
  await runtime.start(); runtime.open();
  const endpoint = runtime.endpoint;
  if (!(endpoint instanceof IcqqEndpoint)) throw new Error('Expected the actual Client');
  endpoint.terminate();
  if (type === 'qrcode') endpoint.emit('system.login.qrcode', { image: Buffer.from([0, 0, 0]) });
  else if (type === 'slider') endpoint.emit('system.login.slider', { url: 'https://example.com/slider' });
  else if (type === 'device') endpoint.emit('system.login.device', { url: 'https://example.com/verify', phone: '138****0000' });
  else endpoint.emit('system.login.auth', { url: 'https://accounts.qq.com/login/attack?sig=1', device: { guid: 'secret-guid-value' } });
  await vi.waitFor(() => expect(endpoint.loginControl.pending()).toHaveLength(1));
  const pending = endpoint.loginControl.pending()[0]!;
  const context = {
    owner: rootPluginId(), project: () => runtime.index, args: [] as string[],
    config: { notify: { id: 'master-openid' } }, input: { sender: { id: 'master-openid' } },
    use: () => { throw new Error('The Adapter owns login controls, not a plugin resource Map'); }, locale: 'zh-CN',
  };
  return { endpoint, submit, pending, context, assist };
}

describe('ICQQ login recovery commands resolve actual owned incarnations', () => {
  it('accepts the configured notify target as operator', () => {
    expect(isIcqqLoginOperator({}, { sender: { id: '1', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } })).toBe(true);
    // Reachable from any adapter: an owner of one conversation / account / adapter does not qualify.
    for (const level of ['adapter', 'endpoint', 'conversation']) {
      expect(isIcqqLoginOperator({}, { sender: { id: '1', chatRole: 'owner', chatRoleLevels: { owner: level } } })).toBe(false);
    }
    expect(isIcqqLoginOperator({}, { sender: { id: '1', chatRole: 'owner' } })).toBe(false);
    expect(isIcqqLoginOperator({ master: '1' }, { sender: { id: '1' } })).toBe(false);
    expect(isIcqqLoginOperator({ notify: { id: 'openid-1' } }, { sender: { id: 'openid-1' } })).toBe(true);
    expect(isIcqqLoginOperator({ notify: { id: 'openid-1' } }, { sender: { id: 'other' } })).toBe(false);
  });
  it('returns the real SDK QR challenge and pending status', async () => {
    const { context } = await fixture();
    const status = await statusCommand.execute(context as never);
    expect(status).toContain('ICQQ 10001: 离线'); expect(status).toContain('二维码');
    const result = await qrCommand.execute(context as never) as Array<{ type: string; data: unknown }>;
    expect(result[1]).toMatchObject({ type: 'image', data: { media: { kind: 'base64', value: 'AAAA', mime_type: 'image/png' } } });
  });
  it('confirms QR login and submits slider codes to the captured incarnation identity', async () => {
    const qr = await fixture();
    await confirmCommand.execute(qr.context as never);
    expect(qr.submit).toHaveBeenCalledWith(qr.pending.id, 'ok', expect.objectContaining({ canonicalId: expect.any(String), incarnationId: expect.any(String) }));
    const slider = await fixture('slider');
    await codeCommand.execute({ ...slider.context, args: ['123456'] } as never);
    expect(slider.submit).toHaveBeenCalledWith(slider.pending.id, '123456', expect.objectContaining({ canonicalId: expect.any(String), incarnationId: expect.any(String) }));
  });
  it('answers the device lock: status shows the link, confirm continues, code sms asks for an SMS', async () => {
    const device = await fixture('device');
    const status = await statusCommand.execute(device.context as never) as string;
    expect(status).toContain('设备锁验证');
    expect(status).toContain('https://example.com/verify');
    expect(status).toContain('icqq login code 10001 sms');
    await codeCommand.execute({ ...device.context, args: ['sms'] } as never);
    expect(device.submit).toHaveBeenCalledWith(device.pending.id, { action: 'sms', values: {} }, expect.anything());
    await vi.waitFor(() => expect(device.endpoint.sendSmsCode).toHaveBeenCalledTimes(1));
    // The SMS code with an explicit UIN also works with one endpoint (the notice uses that form).
    await vi.waitFor(() => expect(device.endpoint.loginControl.flow()?.steps.at(-1)?.challenge?.kind).toBe('sms'));
    const bad = await codeCommand.execute({ ...device.context, args: ['10001', '12ab'] } as never);
    expect(bad).toContain('提交未通过');
    expect(bad).not.toContain('12ab');
    const ok = await codeCommand.execute({ ...device.context, args: ['10001', '123456'] } as never);
    expect(ok).toContain('短信验证码');
    await vi.waitFor(() => expect(device.endpoint.submitSmsCode).toHaveBeenCalledWith('123456'));

    const other = await fixture('device');
    expect(await confirmCommand.execute(other.context as never)).toContain('设备锁验证确认');
    expect(other.submit).toHaveBeenCalledWith(other.pending.id, { action: 'continue', values: {} }, expect.anything());
  });

  it('points identity verification to the Console and never prints the device JSON', async () => {
    const auth = await fixture('auth');
    const status = await statusCommand.execute(auth.context as never) as string;
    expect(status).toContain('身份验证');
    expect(status).toContain('Console');
    expect(status).not.toContain('secret-guid-value');
    expect(await qrCommand.execute(auth.context as never)).toContain('不是扫码登录');
    expect(await codeCommand.execute({ ...auth.context, args: ['x'] } as never)).toContain('Console');
    expect(await confirmCommand.execute(auth.context as never)).toContain('身份验证确认');
  });

  it('reports a failed attempt in status and retries it on request', async () => {
    const qr = await fixture();
    qr.endpoint.emit('system.login.error', { code: 1, message: '密码错误' });
    const status = await statusCommand.execute(qr.context as never) as string;
    expect(status).toContain('上次登录失败：密码错误');
    expect(status).toContain('icqq login retry');
    expect(await retryCommand.execute(qr.context as never)).toContain('已触发 ICQQ 10001 重新登录');
  });
});
