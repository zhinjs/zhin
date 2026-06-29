/**
 * QQ Bot 扫码绑定协议（内联）
 * Protocol aligned with @tencent-connect/qqbot-connector@1.1.0 qqbot-session — inlined to avoid runtime dependency.
 */
import { createDecipheriv, randomBytes } from 'node:crypto';

export type QQBotEnv = 'production' | 'test';

const HOSTS: Record<QQBotEnv, string> = {
  production: 'q.qq.com',
  test: 'test.q.qq.com',
};

export enum BindStatus {
  NONE = 0,
  PENDING = 1,
  COMPLETED = 2,
  EXPIRED = 3,
}

export function getQQBotHost(env: QQBotEnv = 'production'): string {
  return HOSTS[env];
}

export function generateBindKey(): string {
  return randomBytes(32).toString('base64');
}

export function buildConnectUrl(taskId: string, source = 'zhin'): string {
  return `https://${getQQBotHost('production')}/qqbot/openclaw/connect.html?task_id=${encodeURIComponent(taskId)}&source=${encodeURIComponent(source)}&_wv=2`;
}

/**
 * AES-256-GCM 解密 base64 密文。
 * 密文格式: IV(12 bytes) + ciphertext + AuthTag(16 bytes)
 */
export function decryptSecret(encryptedBase64: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const payload = Buffer.from(encryptedBase64, 'base64');
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(12, payload.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

interface LiteApiResponse<T> {
  retcode: number;
  msg?: string;
  data?: T;
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<LiteApiResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return (await res.json()) as LiteApiResponse<T>;
  } finally {
    clearTimeout(timer);
  }
}

export interface BindTaskResult {
  taskId: string;
  key: string;
}

export async function createBindTask(
  env: QQBotEnv = 'production',
  timeoutMs = 10_000,
): Promise<BindTaskResult> {
  const url = `https://${getQQBotHost(env)}/lite/create_bind_task`;
  const key = generateBindKey();
  const res = await postJson<{ task_id?: string }>(url, { key }, timeoutMs);
  if (res.retcode !== 0) {
    throw new Error(res.msg ?? 'create_bind_task failed');
  }
  if (!res.data?.task_id) {
    throw new Error('create_bind_task: missing task_id');
  }
  return { taskId: res.data.task_id, key };
}

export interface PollBindResultOk {
  status: BindStatus;
  botAppId: string;
  botEncryptSecret: string;
  /** 扫码绑定开发者 QQ 的 OpenID（poll_bind_result 返回） */
  userOpenId: string;
}

export function parsePollBindResultData(data: {
  status?: number;
  bot_appid?: string | number;
  bot_encrypt_secret?: string;
  user_openid?: string;
  userOpenid?: string;
  openid?: string;
} | undefined): PollBindResultOk {
  return {
    status: (data?.status ?? BindStatus.NONE) as BindStatus,
    botAppId: String(data?.bot_appid ?? ''),
    botEncryptSecret: data?.bot_encrypt_secret ?? '',
    userOpenId: String(
      data?.user_openid ?? data?.userOpenid ?? data?.openid ?? '',
    ),
  };
}

export async function pollBindResult(
  taskId: string,
  env: QQBotEnv = 'production',
  timeoutMs = 10_000,
): Promise<PollBindResultOk> {
  const url = `https://${getQQBotHost(env)}/lite/poll_bind_result`;
  const res = await postJson<{
    status?: number;
    bot_appid?: string | number;
    bot_encrypt_secret?: string;
    user_openid?: string;
    userOpenid?: string;
    openid?: string;
  }>(url, { task_id: taskId }, timeoutMs);
  if (res.retcode !== 0) {
    throw new Error(res.msg ?? 'poll_bind_result failed');
  }
  return parsePollBindResultData(res.data);
}
