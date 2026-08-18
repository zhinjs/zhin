import type { QrLoginProvider, QrLoginSource, QrPollResult } from './types.js';
import { QQLoginProvider } from './qq.js';
import { NeteaseLoginProvider } from './netease.js';
import { setCredential } from '../credential-store.js';

export type { QrLoginSource, QrPollResult, QrLoginProvider } from './types.js';

const providers: Record<QrLoginSource, QrLoginProvider> = {
  qq: new QQLoginProvider(),
  netease: new NeteaseLoginProvider(),
};

export interface QrLoginSession {
  source: QrLoginSource;
  pollData: Record<string, string>;
  timestamp: number;
  aborted: boolean;
}

const LOGIN_TIMEOUT_MS = 2 * 60 * 1000;
const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = Math.ceil(LOGIN_TIMEOUT_MS / POLL_INTERVAL_MS);

const activeLogins = new Map<string, QrLoginSession>();

export function loginSessionKey(
  endpointId: string,
  conversationId: string,
  senderId: string,
): string {
  return `login:${endpointId}:${conversationId}:${senderId}`;
}

export function getActiveLogin(key: string): QrLoginSession | undefined {
  const session = activeLogins.get(key);
  if (!session) return undefined;
  if (Date.now() - session.timestamp > LOGIN_TIMEOUT_MS) {
    activeLogins.delete(key);
    return undefined;
  }
  return session;
}

export function cancelLogin(key: string): boolean {
  const session = activeLogins.get(key);
  if (!session) return false;
  session.aborted = true;
  activeLogins.delete(key);
  return true;
}

export async function startLogin(
  source: QrLoginSource,
  key: string,
): Promise<{ imageSegment: { type: 'image'; data: Record<string, unknown> } }> {
  const existing = activeLogins.get(key);
  if (existing && !existing.aborted) {
    existing.aborted = true;
  }

  const provider = providers[source];
  const result = await provider.createQr();

  activeLogins.set(key, {
    source,
    pollData: result.pollData,
    timestamp: Date.now(),
    aborted: false,
  });

  return { imageSegment: result.imageSegment };
}

export async function pollLogin(
  key: string,
  onStatus: (result: QrPollResult) => Promise<void>,
): Promise<QrPollResult> {
  const session = activeLogins.get(key);
  if (!session) {
    return { status: 'error', message: '没有进行中的登录会话' };
  }

  const provider = providers[session.source];
  let lastStatus = '';

  try {
    for (let i = 0; i < MAX_POLLS; i++) {
      if (session.aborted) {
        activeLogins.delete(key);
        return { status: 'error', message: '登录已取消' };
      }

      const result = await provider.pollQr(session.pollData);

      if (result.status !== lastStatus) {
        lastStatus = result.status;
        await onStatus(result);
      }

      if (result.status === 'confirmed') {
        activeLogins.delete(key);
        if (result.cookie) {
          await setCredential(session.source, 'cookie', result.cookie);
        }
        return result;
      }
      if (result.status === 'expired' || result.status === 'error') {
        activeLogins.delete(key);
        return result;
      }

      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } catch (err) {
    console.error('[music-login] poll error:', err);
    activeLogins.delete(key);
    return {
      status: 'error',
      message: `轮询异常：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  activeLogins.delete(key);
  return { status: 'expired', message: '登录超时，请重试' };
}

export function cleanExpiredLogins(): void {
  const now = Date.now();
  for (const [key, session] of activeLogins) {
    if (now - session.timestamp > LOGIN_TIMEOUT_MS) {
      session.aborted = true;
      activeLogins.delete(key);
    }
  }
}
