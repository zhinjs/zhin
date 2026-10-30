import { describe, expect, it, vi } from 'vitest';
import { icqqLoginControlToken, type IcqqLoginControl } from '../src/icqq-login-control.js';
import statusCommand from '../commands/icqq/login/status/index.js';
import qrCommand from '../commands/icqq/login/qr/index.js';
import confirmCommand from '../commands/icqq/login/confirm/index.js';
import codeCommand from '../commands/icqq/login/code/index.js';
import { isIcqqLoginOperator } from '../commands/icqq/login/definition.js';

function fixture(type: 'qrcode' | 'slider' = 'qrcode') {
  const pending = {
    id: 'login-1',
    adapter: 'icqq',
    endpointKey: '10001',
    type,
    payload: type === 'qrcode' ? { image: 'data:image/png;base64,AAAA' } : { url: 'https://example.com/slider' },
    createdAt: 1,
  };
  const control: IcqqLoginControl = {
    endpointId: '10001',
    state: () => ({
      endpointId: '10001',
      transportState: 'reconnecting',
      online: false,
      pending: [pending],
    }),
    pending: () => [pending],
    relogin: vi.fn(async () => undefined),
    submit: vi.fn(() => true),
    cancel: vi.fn(() => true),
  };
  const controls = new Map([['10001', control]]);
  const context = {
    args: [] as string[],
    config: { master: 'master', notify: { id: 'master-openid' } },
    input: { sender: { id: 'master-openid' } },
    use: (token: unknown) => {
      if (token === icqqLoginControlToken) return controls;
      throw new Error('unexpected token');
    },
    locale: 'zh-CN',
  };
  return { control, context };
}

describe('icqq login recovery commands', () => {
  it('accepts the configured notify target as operator', () => {
    expect(isIcqqLoginOperator({ master: '1' }, { sender: { id: '1' } })).toBe(true);
    expect(isIcqqLoginOperator({ master: '1', notify: { id: 'openid-1' } }, { sender: { id: 'openid-1' } })).toBe(true);
    expect(isIcqqLoginOperator({ master: '1', notify: { id: 'openid-1' } }, { sender: { id: 'other' } })).toBe(false);
  });

  it('returns the QR image and pending status', async () => {
    const { context } = fixture();
    const status = await statusCommand.execute(context as never);
    expect(status).toContain('ICQQ 10001: 离线');
    expect(status).toContain('二维码');

    const result = await qrCommand.execute(context as never) as Array<{
      type: string;
      data: { media?: { kind: string; value: string } };
    }>;
    expect(result[1]).toMatchObject({
      type: 'image',
      data: { media: { kind: 'base64', value: 'AAAA', mime_type: 'image/png' } },
    });
  });

  it('confirms QR login and submits verification codes', async () => {
    const qr = fixture();
    await confirmCommand.execute(qr.context as never);
    expect(qr.control.submit).toHaveBeenCalledWith('login-1', 'ok');

    const slider = fixture('slider');
    await codeCommand.execute({ ...slider.context, args: ['123456'] } as never);
    expect(slider.control.submit).toHaveBeenCalledWith('login-1', '123456');
  });
});
