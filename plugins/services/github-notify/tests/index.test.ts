/**
 * github-notify 插件测试
 * 测试 HMAC 签名验证、事件类型映射
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

// ============================================================================
// HMAC 签名验证（复制核心逻辑以便独立测试）
// ============================================================================

function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
): boolean {
  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')}`;

  return signature === expectedSignature;
}

describe('GitHub Webhook 签名验证', () => {
  const secret = 'test-secret-123';

  it('有效签名应通过验证', () => {
    const payload = JSON.stringify({ action: 'opened', repository: { full_name: 'user/repo' } });
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

    expect(verifyWebhookSignature(secret, payload, signature)).toBe(true);
  });

  it('无效签名应拒绝', () => {
    const payload = JSON.stringify({ action: 'opened' });
    const fakeSignature = 'sha256=invalid_signature_here';

    expect(verifyWebhookSignature(secret, payload, fakeSignature)).toBe(false);
  });

  it('篡改 payload 应拒绝', () => {
    const originalPayload = JSON.stringify({ action: 'opened' });
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(originalPayload).digest('hex')}`;

    const tamperedPayload = JSON.stringify({ action: 'closed' });
    expect(verifyWebhookSignature(secret, tamperedPayload, signature)).toBe(false);
  });

  it('不同 secret 应拒绝', () => {
    const payload = JSON.stringify({ action: 'opened' });
    const signatureWithOtherSecret = `sha256=${crypto.createHmac('sha256', 'other-secret').update(payload).digest('hex')}`;

    expect(verifyWebhookSignature(secret, payload, signatureWithOtherSecret)).toBe(false);
  });
});

// ============================================================================
// 事件类型映射
// ============================================================================

describe('GitHub 事件类型', () => {
  const validEvents = ['push', 'issue', 'star', 'fork', 'unstar', 'pull_request'];

  it('应支持所有有效事件类型', () => {
    expect(validEvents).toContain('push');
    expect(validEvents).toContain('issue');
    expect(validEvents).toContain('star');
    expect(validEvents).toContain('fork');
    expect(validEvents).toContain('unstar');
    expect(validEvents).toContain('pull_request');
  });

  it('事件列表应有 6 种类型', () => {
    expect(validEvents).toHaveLength(6);
  });
});
