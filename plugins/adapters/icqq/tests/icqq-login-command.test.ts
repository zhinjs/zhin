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
import { isIcqqLoginOperator } from '../commands/icqq/login/definition.js';

const fixtures: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(close => close())); });
async function fixture(type: 'qrcode' | 'slider' = 'qrcode') {
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
  else endpoint.emit('system.login.slider', { url: 'https://example.com/slider' });
  await vi.waitFor(() => expect(endpoint.loginControl.pending()).toHaveLength(1));
  const pending = endpoint.loginControl.pending()[0]!;
  const context = {
    owner: rootPluginId(), project: () => runtime.index, args: [] as string[],
    config: { master: 'master', notify: { id: 'master-openid' } }, input: { sender: { id: 'master-openid' } },
    use: () => { throw new Error('The Adapter owns login controls, not a plugin resource Map'); }, locale: 'zh-CN',
  };
  return { endpoint, submit, pending, context };
}

describe('ICQQ login recovery commands resolve actual owned incarnations', () => {
  it('accepts the configured notify target as operator', () => {
    expect(isIcqqLoginOperator({ master: '1' }, { sender: { id: '1' } })).toBe(true);
    expect(isIcqqLoginOperator({ master: '1', notify: { id: 'openid-1' } }, { sender: { id: 'openid-1' } })).toBe(true);
    expect(isIcqqLoginOperator({ master: '1', notify: { id: 'openid-1' } }, { sender: { id: 'other' } })).toBe(false);
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
});
