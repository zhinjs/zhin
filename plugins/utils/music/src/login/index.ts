import type { QrLoginProvider, QrLoginSource, QrPollResult } from './types.js';
import { QQLoginProvider } from './qq.js';
import { NeteaseLoginProvider } from './netease.js';
import type { CredentialStore } from '../credential-store.js';

export type { QrLoginSource, QrPollResult, QrLoginProvider } from './types.js';

export interface QrLoginSession {
  source: QrLoginSource;
  pollData: Record<string, string>;
  timestamp: number;
  aborted: boolean;
}

const LOGIN_TIMEOUT_MS = 2 * 60 * 1000;
const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = Math.ceil(LOGIN_TIMEOUT_MS / POLL_INTERVAL_MS);

export function loginSessionKey(
  endpointId: string,
  conversationId: string,
  senderId: string,
): string {
  return `login:${endpointId}:${conversationId}:${senderId}`;
}

/** Generation-owned QR login coordinator. */
export class QrLoginRuntime {
  readonly #active = new Map<string, QrLoginSession>();
  readonly #providers: Readonly<Record<QrLoginSource, QrLoginProvider>>;
  readonly #credentials: CredentialStore;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(
    credentials: CredentialStore,
    providers?: Readonly<Record<QrLoginSource, QrLoginProvider>>,
    now: () => number = Date.now,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.#credentials = credentials;
    this.#now = now;
    this.#sleep = sleep;
    this.#providers = providers ?? {
      qq: new QQLoginProvider(),
      netease: new NeteaseLoginProvider(),
    };
  }

  get(key: string): QrLoginSession | undefined {
    const session = this.#active.get(key);
    if (!session) return undefined;
    if (this.#now() - session.timestamp > LOGIN_TIMEOUT_MS) {
      session.aborted = true;
      this.#active.delete(key);
      return undefined;
    }
    return session;
  }

  cancel(key: string): boolean {
    const session = this.#active.get(key);
    if (!session) return false;
    session.aborted = true;
    this.#active.delete(key);
    return true;
  }

  async start(
    source: QrLoginSource,
    key: string,
  ): Promise<{ imageSegment: { type: 'image'; data: Record<string, unknown> } }> {
    const existing = this.#active.get(key);
    if (existing && !existing.aborted) existing.aborted = true;
    const session: QrLoginSession = {
      source,
      pollData: {},
      timestamp: this.#now(),
      aborted: false,
    };
    this.#active.set(key, session);

    try {
      const result = await this.#providers[source].createQr();
      if (session.aborted || this.#active.get(key) !== session) {
        throw new Error('登录已取消');
      }
      session.pollData = result.pollData;
      return { imageSegment: result.imageSegment };
    } catch (error) {
      if (this.#active.get(key) === session) this.#active.delete(key);
      throw error;
    }
  }

  async poll(
    key: string,
    onStatus: (result: QrPollResult) => Promise<void>,
  ): Promise<QrPollResult> {
    const session = this.#active.get(key);
    if (!session) return { status: 'error', message: '没有进行中的登录会话' };

    const provider = this.#providers[session.source];
    let lastStatus = '';
    try {
      for (let i = 0; i < MAX_POLLS; i++) {
        if (session.aborted) {
          this.#active.delete(key);
          return { status: 'error', message: '登录已取消' };
        }

        const result = await provider.pollQr(session.pollData);
        if (result.status !== lastStatus) {
          lastStatus = result.status;
          await onStatus(result);
        }
        if (result.status === 'confirmed') {
          this.#active.delete(key);
          if (result.cookie) await this.#credentials.set(session.source, 'cookie', result.cookie);
          return result;
        }
        if (result.status === 'expired' || result.status === 'error') {
          this.#active.delete(key);
          return result;
        }
        await this.#sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      this.#active.delete(key);
      return {
        status: 'error',
        message: `轮询异常：${error instanceof Error ? error.message : String(error)}`,
      };
    }

    this.#active.delete(key);
    return { status: 'expired', message: '登录超时，请重试' };
  }

  pruneExpired(): void {
    const now = this.#now();
    for (const [key, session] of this.#active) {
      if (now - session.timestamp > LOGIN_TIMEOUT_MS) {
        session.aborted = true;
        this.#active.delete(key);
      }
    }
  }

  dispose(): void {
    for (const session of this.#active.values()) session.aborted = true;
    this.#active.clear();
  }
}
