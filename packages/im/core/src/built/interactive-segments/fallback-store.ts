import { resolveTextFallbackPayload } from './action.js';

/**
 * keyboard 文本降级 fallback map 的中央存储。
 *
 * 出站：端点 interactive 策略为 'text' 时，框架把 keyboard 段降级为编号文本，
 * 同时把「数字 → payload」映射按频道写入本存储（后写覆盖先写，等价
 * game-kit lastMenus 的“最近一张键盘”语义）。
 * 入站：框架中间件 / dispatcher 钩子用本存储把用户回复的裸数字解析回
 * payload，再按 prefix 最长匹配路由给注册的 interactive handler。
 *
 * 模块级共享实例与 handlers.ts 的 handler 注册表同例：状态按频道键控、
 * TTL 有界（对齐 game-hub 菜单上下文的 1h），无裸悬挂业务对象。
 */
export const KEYBOARD_FALLBACK_TTL_MS = 60 * 60 * 1000;

interface KeyboardFallbackEntry {
  readonly map: Record<string, string>;
  readonly expiresAt: number;
}

export class KeyboardFallbackStore {
  readonly #entries = new Map<string, KeyboardFallbackEntry>();

  constructor(private readonly defaultTtlMs: number = KEYBOARD_FALLBACK_TTL_MS) {}

  /** 记录频道最近一次 keyboard 降级的数字→payload 映射（空 map 忽略）。 */
  remember(
    channelKey: string,
    map: Record<string, string>,
    ttlMs: number = this.defaultTtlMs,
  ): void {
    if (Object.keys(map).length === 0) return;
    this.#prune();
    this.#entries.set(channelKey, {
      map: Object.freeze({ ...map }),
      expiresAt: Date.now() + ttlMs,
    });
  }

  /** 频道当前有效的 fallback map（过期即删并返回 undefined）。 */
  mapFor(channelKey: string): Record<string, string> | undefined {
    const entry = this.#entries.get(channelKey);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.#entries.delete(channelKey);
      return undefined;
    }
    return entry.map;
  }

  /** 裸数字 / fallback 键 → payload（无映射或过期返回 undefined）。 */
  resolve(channelKey: string, raw: string): string | undefined {
    const map = this.mapFor(channelKey);
    return map ? resolveTextFallbackPayload(raw, map) : undefined;
  }

  clear(): void {
    this.#entries.clear();
  }

  #prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt < now) this.#entries.delete(key);
    }
  }
}

/** 中央共享实例：出站降级写入、入站回跳读取。 */
export const keyboardFallbackStore = new KeyboardFallbackStore();

/** 测试专用：清空中央 fallback 存储。 */
export function resetKeyboardFallbackStoreForTests(): void {
  keyboardFallbackStore.clear();
}
