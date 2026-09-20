import fs from 'node:fs';
import path from 'node:path';
import type { WeixinIlinkStateStore } from './credentials.js';
import { logger } from './ilink-logger.js';

const PERSIST_DEBOUNCE_MS = 500;

/** Endpoint-owned context-token repository with account-scoped persistence. */
export class WeixinContextTokenStore {
  readonly state: WeixinIlinkStateStore;
  readonly #tokens = new Map<string, string>();
  #persistTimer?: ReturnType<typeof setTimeout>;

  constructor(state: WeixinIlinkStateStore) {
    this.state = state;
  }

  get accountId(): string {
    return this.state.endpointId;
  }

  get(userId: string): string | undefined {
    const value = this.#tokens.get(userId);
    logger.debug(`contextTokenStore.get: account=${this.accountId} user=${userId} found=${value !== undefined} storeSize=${this.#tokens.size}`);
    return value;
  }

  set(userId: string, token: string): void {
    logger.debug(`contextTokenStore.set: account=${this.accountId} user=${userId}`);
    this.#tokens.set(userId, token);
    this.#schedulePersist();
  }

  userIds(): string[] {
    return [...this.#tokens.keys()];
  }

  restore(): void {
    const filePath = this.#filePath();
    try {
      if (!fs.existsSync(filePath)) return;
      const tokens = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      let count = 0;
      for (const [userId, token] of Object.entries(tokens)) {
        if (typeof token !== 'string' || !token) continue;
        this.#tokens.set(userId, token);
        count += 1;
      }
      logger.info(`contextTokenStore.restore: restored ${count} tokens for account=${this.accountId}`);
    } catch (error) {
      logger.warn(`contextTokenStore.restore: failed to read ${filePath}: ${String(error)}`);
    }
  }

  flush(): void {
    if (this.#persistTimer) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = undefined;
    }
    this.#persist();
  }

  clear(): void {
    if (this.#persistTimer) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = undefined;
    }
    this.#tokens.clear();
    const filePath = this.#filePath();
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
      logger.warn(`contextTokenStore.clear: failed to remove ${filePath}: ${String(error)}`);
    }
  }

  #filePath(): string {
    return this.state.contextTokensPath();
  }

  #schedulePersist(): void {
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = undefined;
      this.#persist();
    }, PERSIST_DEBOUNCE_MS);
    this.#persistTimer.unref?.();
  }

  #persist(): void {
    const filePath = this.#filePath();
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(Object.fromEntries(this.#tokens)), 'utf-8');
    } catch (error) {
      logger.warn(`contextTokenStore.persist: failed to write ${filePath}: ${String(error)}`);
    }
  }
}

export { bodyFromItemList, isMediaItem } from './weixin-inbound.js';
