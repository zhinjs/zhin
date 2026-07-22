import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { startQqBindFlow } from '../src/qq-bind-flow.js';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 与 qq-bind-api decryptSecret 对应的 AES-256-GCM 加密（IV(12) + ciphertext + AuthTag(16)） */
function encryptSecret(plain: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startQqBindFlow', () => {
  it('用户 cancel（AbortError）不应触发 onFailure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );

    const onFailure = vi.fn();
    const stop = startQqBindFlow(
      {
        onSuccess: vi.fn(),
        onFailure,
        onQrDisplayed: vi.fn(),
      },
      { source: 'zhin' },
    );

    stop();
    await new Promise((r) => setTimeout(r, 20));

    expect(onFailure).not.toHaveBeenCalled();
  });

  it('扫码成功后回调 onQrDisplayed 与 onSuccess（解密出凭据）', async () => {
    let bindKey = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
        if (url.includes('create_bind_task')) {
          bindKey = body.key;
          return jsonResponse({ retcode: 0, data: { task_id: 'task-1' } });
        }
        if (url.includes('poll_bind_result')) {
          expect(body.task_id).toBe('task-1');
          return jsonResponse({
            retcode: 0,
            data: {
              status: 2,
              bot_appid: '102000001',
              bot_encrypt_secret: encryptSecret('top-secret', bindKey),
              user_openid: 'user-open-1',
            },
          });
        }
        throw new Error(`unexpected url: ${url}`);
      }),
    );

    const qrUrls: string[] = [];
    const result = await new Promise<{ appId: string; appSecret: string; userOpenId?: string }>(
      (resolve, reject) => {
        startQqBindFlow(
          {
            onQrDisplayed: (url) => {
              qrUrls.push(url);
            },
            onSuccess: (credentials) => resolve(credentials[0]!),
            onFailure: reject,
          },
          { source: 'zhin' },
        );
      },
    );

    expect(qrUrls).toHaveLength(1);
    expect(qrUrls[0]).toContain('task_id=task-1');
    expect(result).toEqual({
      appId: '102000001',
      appSecret: 'top-secret',
      userOpenId: 'user-open-1',
    });
  });

  it('create_bind_task 失败时回调 onFailure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ retcode: 1, msg: 'boom' })),
    );

    const error = await new Promise<Error>((resolve) => {
      startQqBindFlow({
        onSuccess: vi.fn(),
        onFailure: resolve,
      });
    });

    expect(error.message).toContain('获取绑定任务失败');
    expect(error.message).toContain('boom');
  });
});
