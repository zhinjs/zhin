import { afterEach, describe, expect, it, vi } from 'vitest';
import inquirer from 'inquirer';

vi.mock('../src/weixin-ilink-login.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/weixin-ilink-login.js')>();
  return {
    ...original,
    loginWithIlinkQr: vi.fn(),
  };
});

const { configureWeixinIlinkBot } = await import('../src/adapter-configurers.js');
const { loginWithIlinkQr, IlinkQrLoginError } = await import('../src/weixin-ilink-login.js');

function mockPrompt(answers: Record<string, unknown>) {
  return vi.spyOn(inquirer, 'prompt').mockImplementation(async (questions: any) => {
    const list = Array.isArray(questions) ? questions : [questions];
    const out: Record<string, unknown> = {};
    for (const q of list) out[q.name] = answers[q.name];
    return out as any;
  });
}

const configureCtx = () => ({ envVars: {} as Record<string, string>, markRequiresDatabase: () => {} });

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loginWithIlinkQr).mockReset();
});

describe('configureWeixinIlinkBot', () => {
  it('扫码绑定成功：token 写入 envVars，配置引用 ${WEIXIN_ILINK_TOKEN}', async () => {
    mockPrompt({ endpointName: 'weixin-bot', method: 'qr' });
    vi.mocked(loginWithIlinkQr).mockResolvedValue({
      botToken: 'scanned-token',
      baseUrl: 'https://ilinkai.weixin.qq.com',
    });
    const ctx = configureCtx();
    const config = await configureWeixinIlinkBot(ctx);

    expect(config).toEqual({
      endpoints: [{ name: 'weixin-bot', botToken: '${WEIXIN_ILINK_TOKEN}' }],
    });
    expect(ctx.envVars.WEIXIN_ILINK_TOKEN).toBe('scanned-token');
  });

  it('手动输入 token：同样的配置形状', async () => {
    mockPrompt({ endpointName: 'my-wechat', method: 'manual', token: 'manual-token' });
    const ctx = configureCtx();
    const config = await configureWeixinIlinkBot(ctx);

    expect(config).toEqual({
      endpoints: [{ name: 'my-wechat', botToken: '${WEIXIN_ILINK_TOKEN}' }],
    });
    expect(ctx.envVars.WEIXIN_ILINK_TOKEN).toBe('manual-token');
    expect(loginWithIlinkQr).not.toHaveBeenCalled();
  });

  it('扫码过期且用户放弃重试 → 降级手动输入', async () => {
    mockPrompt({ endpointName: 'weixin-bot', method: 'qr', retry: false, token: 'fallback-token' });
    vi.mocked(loginWithIlinkQr).mockRejectedValue(new IlinkQrLoginError('二维码已过期', 'expired'));
    const ctx = configureCtx();
    const config = await configureWeixinIlinkBot(ctx);

    expect(config).toEqual({
      endpoints: [{ name: 'weixin-bot', botToken: '${WEIXIN_ILINK_TOKEN}' }],
    });
    expect(ctx.envVars.WEIXIN_ILINK_TOKEN).toBe('fallback-token');
  });

  it('扫码过期后用户选择重试并最终成功', async () => {
    mockPrompt({ endpointName: 'weixin-bot', method: 'qr', retry: true });
    vi.mocked(loginWithIlinkQr)
      .mockRejectedValueOnce(new IlinkQrLoginError('二维码已过期', 'expired'))
      .mockResolvedValueOnce({ botToken: 'retry-token', baseUrl: 'https://ilinkai.weixin.qq.com' });
    const ctx = configureCtx();
    await configureWeixinIlinkBot(ctx);

    expect(loginWithIlinkQr).toHaveBeenCalledTimes(2);
    expect(ctx.envVars.WEIXIN_ILINK_TOKEN).toBe('retry-token');
  });
});
