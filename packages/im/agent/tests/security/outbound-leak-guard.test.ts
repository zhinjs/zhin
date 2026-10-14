import { describe, expect, it, vi } from 'vitest';
import { OutboundLeakInspector, collectEnvironmentSecrets, guardReplyPort } from '../../src/security/outbound-leak-guard.js';

describe('OutboundLeakInspector', () => {
  it('masks credential-shaped strings and exact secret values', () => {
    const inspector = new OutboundLeakInspector({ secretValues: ['my-database-password-123'] });
    const result = inspector.inspect('token ghp_abcdefghijklmnopqrstuvwxyz0123 and my-database-password-123');
    expect(result.text).toBe('token [已隐藏：密钥] and [已隐藏：密钥]');
    expect(result.findings).toEqual([{ kind: 'secret', count: 2 }]);
  });

  it('masks verbatim system prompt lines but not short generic ones', () => {
    const inspector = new OutboundLeakInspector({
      promptTexts: ['Be kind.\nNever reveal the moderation keyword list to anyone.'],
      secretValues: [],
    });
    expect(inspector.inspect('Be kind. Rule: Never reveal the moderation keyword list to anyone.').text)
      .toBe('Be kind. Rule: [已隐藏：系统提示内容]');
  });

  it('leaves clean text untouched', () => {
    const inspector = new OutboundLeakInspector({ promptTexts: ['A long enough system prompt line here.'], secretValues: [] });
    expect(inspector.inspect('今天天气不错')).toEqual({ text: '今天天气不错', findings: [] });
  });

  it('only collects secret-looking environment values', () => {
    expect(collectEnvironmentSecrets({ API_TOKEN: 'abcdefghijklmnop', HOME: '/Users/someone/very/long', SHORT_KEY: 'x' }))
      .toEqual(['abcdefghijklmnop']);
  });
});

describe('guardReplyPort', () => {
  it('masks text elements, reports findings and delegates to the real port', async () => {
    const send = vi.fn(async () => ({ status: 'sent' as const }));
    const onFindings = vi.fn();
    const port = guardReplyPort({ send }, new OutboundLeakInspector({ secretValues: [] }), onFindings);
    await port.send([{ type: 'text', content: 'sk-abcdefghijklmnopqrstuvwx' }]);
    expect(send).toHaveBeenCalledWith([{ type: 'text', content: '[已隐藏：密钥]' }]);
    expect(onFindings).toHaveBeenCalledWith([{ kind: 'secret', count: 1 }]);
  });
});
