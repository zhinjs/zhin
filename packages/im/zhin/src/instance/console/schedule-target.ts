/**
 * Delivery target of a persistent schedule job, as operators see it (#1250): the account's
 * display name and the conversation, or why the target cannot receive anything.
 */

/** Optional `target` field of `zhin schedule list` / `GET /assistant/jobs` rows and `schedule:list` persistent rows. */
export interface ScheduleTargetView {
  /** `false`: the job's results cannot be delivered (no target, or its account does not exist). */
  readonly resolved: boolean;
  /** e.g. `sandbox-bot（sandbox）· 私聊 u1`; `不投递` / `仅记录日志` for silent / log jobs. */
  readonly display?: string;
  /** Why it is not resolved: `missing_target` | `incomplete_target` | `endpoint_not_found`. */
  readonly reason?: ScheduleTargetIssue;
}

export type ScheduleTargetIssue = 'missing_target' | 'incomplete_target' | 'endpoint_not_found';

/** Account lookup by adapter alias + endpoint key (`im.endpoints.get`). */
export type ScheduleEndpointLookup = (adapter: string, endpointKey: string) => Readonly<{ name: string; adapter: string }> | null;

interface SceneLike {
  readonly platform?: unknown;
  readonly endpointKey?: unknown;
  readonly sceneId?: unknown;
  readonly kind?: unknown;
}

const KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  private: '私聊', group: '群', channel: '频道', guild: '服务器',
});

const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

function sceneOf(notify: unknown): SceneLike | undefined {
  const target = notify && typeof notify === 'object' ? (notify as { target?: unknown }).target : undefined;
  const scene = target && typeof target === 'object' ? (target as { scene?: unknown }).scene : undefined;
  return scene && typeof scene === 'object' ? scene as SceneLike : undefined;
}

/** `null` lookup: the IM runtime is not available, so the account cannot be checked (treated as resolved). */
export function describeScheduleTarget(notify: unknown, lookup: ScheduleEndpointLookup | null): ScheduleTargetView {
  const channel = notify && typeof notify === 'object' ? (notify as { channel?: unknown }).channel : undefined;
  if (channel === 'silent' || channel === undefined) return Object.freeze({ resolved: true, display: '不投递' });
  if (channel === 'log') return Object.freeze({ resolved: true, display: '仅记录日志' });
  if (channel === 'ha') {
    const service = text((notify as { service?: unknown }).service);
    return Object.freeze({ resolved: true, display: service ? `Home Assistant ${service}` : 'Home Assistant' });
  }
  if (channel !== 'im') return Object.freeze({ resolved: false, reason: 'incomplete_target' });
  const scene = sceneOf(notify);
  if (!scene) return Object.freeze({ resolved: false, reason: 'missing_target' });
  const adapter = text(scene.platform);
  const endpointKey = text(scene.endpointKey);
  const sceneId = text(scene.sceneId);
  const kind = text(scene.kind);
  if (!adapter || !endpointKey || !sceneId || !kind) {
    return Object.freeze({ resolved: false, reason: 'incomplete_target' });
  }
  const conversation = `${KIND_LABELS[kind] ?? kind} ${sceneId}`;
  if (!lookup) return Object.freeze({ resolved: true, display: `${endpointKey}（${adapter}）· ${conversation}` });
  const endpoint = lookup(adapter, endpointKey);
  if (!endpoint) {
    return Object.freeze({ resolved: false, reason: 'endpoint_not_found', display: `${endpointKey}（${adapter}）· ${conversation}` });
  }
  return Object.freeze({ resolved: true, display: `${endpoint.name}（${adapter}）· ${conversation}` });
}

export const SCHEDULE_TARGET_KINDS = Object.freeze(['private', 'group', 'channel'] as const);

/**
 * `<adapter>:<endpoint>:<kind>:<id>` (`zhin schedule add --target`) → an IM delivery target. The
 * conversation id may itself contain `:`.
 */
export function parseScheduleTargetSpec(spec: string):
  | { readonly target: { channel: 'im'; scene: { platform: string; endpointKey: string; kind: string; sceneId: string } } }
  | { readonly error: string } {
  const parts = spec.trim().split(':');
  if (parts.length < 4) return { error: '目标格式应为 <adapter>:<endpoint>:<kind>:<id>，例如 sandbox:sandbox-bot:private:u1' };
  const [platform, endpointKey, kind, ...rest] = parts.map(part => part.trim());
  const sceneId = rest.join(':').trim();
  if (!platform || !endpointKey || !sceneId) return { error: '目标的 adapter、endpoint 与会话 id 都不能为空' };
  if (!(SCHEDULE_TARGET_KINDS as readonly string[]).includes(kind!)) {
    return { error: `目标会话类型无效：${kind}（可选 ${SCHEDULE_TARGET_KINDS.join(' | ')}）` };
  }
  return { target: { channel: 'im', scene: { platform: platform!, endpointKey: endpointKey!, kind: kind!, sceneId } } };
}

/** Lookup over the IM runtime's accounts; an unknown adapter or account is `null`. */
export function scheduleEndpointLookup(endpoints: Readonly<{
  get(adapter: string, endpointKey: string): Readonly<{ name: string; adapter: string }> | null;
}> | undefined): ScheduleEndpointLookup | undefined {
  if (!endpoints) return undefined;
  return (adapter, endpointKey) => {
    try {
      const found = endpoints.get(adapter, endpointKey);
      return found ? { name: found.name, adapter: found.adapter } : null;
    } catch {
      return null;
    }
  };
}

/** Adds `target` ({@link ScheduleTargetView}) to each persistent job row. */
export function withScheduleTargets<T extends Readonly<{ notify?: unknown }>>(
  jobs: readonly T[], lookup: ScheduleEndpointLookup | undefined,
): (T & { target: ScheduleTargetView })[] {
  return jobs.map(job => ({ ...job, target: describeScheduleTarget(job.notify, lookup ?? null) }));
}
