import { conversationRefKey, type ConversationRef } from 'zhin.js';
import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
import { DEFAULT_REPEATER_CONFIG } from './config.js';
import type { RepeaterConfig } from './config.js';
export { DEFAULT_REPEATER_CONFIG } from './config.js';
export type { RepeaterConfig } from './config.js';

export interface RepeaterInboundFields {
  readonly conversation: ConversationRef;
  readonly content: string;
  readonly sender?: { readonly id: string; readonly name?: string } | string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Repeater state belongs to the exact incoming conversation, including its account and thread. */
export function resolveGroupId(message: RepeaterInboundFields): string | null {
  return message.conversation.kind === 'private' ? null : conversationRefKey(message.conversation);
}

interface RepeatState {
  content: string;
  users: Set<string>;
  repeated: boolean;
  lastTime: number;
}

export type RepeaterTickResult =
  | { readonly action: 'next' }
  | { readonly action: 'repeat'; readonly content: string };

export class RepeaterEngine {
  readonly #groupStates = new Map<string, RepeatState>();
  readonly #cooldownSet = new Map<string, number>();
  #totalRepeats = 0;
  #cleanupTimer?: ReturnType<typeof setInterval>;
  /** 最近一次 tick 的配置冷却，供 pruneStale 用实际配置而非默认值清理。 */
  #lastCooldown: number = DEFAULT_REPEATER_CONFIG.cooldown;

  constructor() {
    this.#cleanupTimer = setInterval(() => this.pruneStale(), 120_000);
    if (typeof this.#cleanupTimer === 'object' && 'unref' in this.#cleanupTimer) {
      this.#cleanupTimer.unref();
    }
  }

  get totalRepeats(): number {
    return this.#totalRepeats;
  }

  get activeGroups(): number {
    return this.#groupStates.size;
  }

  tick(message: RepeaterInboundFields, config: RepeaterConfig): RepeaterTickResult {
    this.#lastCooldown = config.cooldown;
    const groupId = resolveGroupId(message);
    if (!groupId) return { action: 'next' };

    const content = message.content.trim();
    if (!content || content.length > config.maxLength) return { action: 'next' };

    const rawSender = message.sender;
    const senderId = typeof rawSender === 'object' ? rawSender?.id ?? '' : String(rawSender ?? '');
    if (!senderId) return { action: 'next' };

    const state = this.#groupStates.get(groupId);
    if (state && state.content === content) {
      if (state.users.has(senderId)) return { action: 'next' };
      state.users.add(senderId);
      state.lastTime = Date.now();
      if (state.users.size >= config.threshold && !state.repeated) {
        const lastCd = this.#cooldownSet.get(groupId);
        if (lastCd && Date.now() - lastCd < config.cooldown) {
          return { action: 'next' };
        }
        state.repeated = true;
        this.#cooldownSet.set(groupId, Date.now());
        this.#totalRepeats += 1;
        return { action: 'repeat', content };
      }
      return { action: 'next' };
    }

    this.#groupStates.set(groupId, {
      content,
      users: new Set([senderId]),
      repeated: false,
      lastTime: Date.now(),
    });
    return { action: 'next' };
  }

  statusLines(config: RepeaterConfig, locale?: Locale): string {
    return t(locale, 'status', { groups: this.activeGroups, threshold: config.threshold,
      cooldown: config.cooldown / 1000, length: config.maxLength, repeats: this.#totalRepeats });
  }

  pruneStale(now = Date.now(), expiry = 5 * 60_000, cooldown = this.#lastCooldown): void {
    for (const [key, state] of this.#groupStates) {
      if (now - state.lastTime > expiry) this.#groupStates.delete(key);
    }
    for (const [key, time] of this.#cooldownSet) {
      if (now - time > cooldown * 2) this.#cooldownSet.delete(key);
    }
  }

  dispose(): void {
    if (this.#cleanupTimer) clearInterval(this.#cleanupTimer);
    this.#cleanupTimer = undefined;
    this.#groupStates.clear();
    this.#cooldownSet.clear();
  }
}
