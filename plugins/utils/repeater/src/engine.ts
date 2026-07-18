export interface RepeaterConfig {
  readonly threshold: number;
  readonly cooldown: number;
  readonly maxLength: number;
}

export const DEFAULT_REPEATER_CONFIG: RepeaterConfig = Object.freeze({
  threshold: 3,
  cooldown: 30_000,
  maxLength: 200,
});

export function resolveRepeaterConfig(raw: unknown): RepeaterConfig {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const threshold = clampNumber(input.threshold, DEFAULT_REPEATER_CONFIG.threshold, 2, 10);
  const cooldown = clampNumber(input.cooldown, DEFAULT_REPEATER_CONFIG.cooldown, 5_000, 300_000);
  const maxLength = clampNumber(input.maxLength, DEFAULT_REPEATER_CONFIG.maxLength, 10, 1_000);
  return Object.freeze({ threshold, cooldown, maxLength });
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export interface RepeaterInboundFields {
  readonly target: string;
  readonly content: string;
  readonly sender?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Best-effort group detection for Plugin Runtime `Message`.
 * Gap: channel type is not a first-class Message field; we read
 * `metadata.type` / `metadata.channelType` when present. Without them,
 * a non-empty `target` is treated as a group key (may false-positive DMs).
 */
export function resolveGroupId(message: RepeaterInboundFields): string | null {
  const meta = message.metadata ?? {};
  const type = meta.type ?? meta.channelType
    ?? (meta.channel && typeof meta.channel === 'object'
      ? (meta.channel as { type?: unknown }).type
      : undefined);
  if (type === 'private') return null;
  if (type === 'group' || type === 'channel') {
    return String(message.target || '');
  }
  if (type != null) return null;
  return message.target ? String(message.target) : null;
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
    const groupId = resolveGroupId(message);
    if (!groupId) return { action: 'next' };

    const content = message.content.trim();
    if (!content || content.length > config.maxLength) return { action: 'next' };

    const senderId = String(message.sender ?? '');
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

  statusLines(config: RepeaterConfig): string {
    return [
      '复读机状态',
      `监控群数: ${this.activeGroups}`,
      `触发阈值: ${config.threshold} 人`,
      `冷却时间: ${config.cooldown / 1000}s`,
      `消息长度上限: ${config.maxLength}`,
      `累计复读: ${this.#totalRepeats} 次`,
    ].join('\n');
  }

  pruneStale(now = Date.now(), expiry = 5 * 60_000, cooldown = DEFAULT_REPEATER_CONFIG.cooldown): void {
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

let shared: RepeaterEngine | undefined;

export function getRepeaterEngine(): RepeaterEngine {
  if (!shared) shared = new RepeaterEngine();
  return shared;
}

/** Test helper — reset the process-wide singleton. */
export function resetRepeaterEngine(): void {
  shared?.dispose();
  shared = undefined;
}
