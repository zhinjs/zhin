/**
 * `zhin doctor` checks of ADR 0066 (the interjection judge):
 * - the retired `ai.trigger.ambient.minConfidence` / `mode` keys of the configuration file: a
 *   warning (an error after the deprecation window), removed by `--fix` through the same lock,
 *   revision check and atomic write as every other config writer;
 * - the migration of the running instance: its result once (⚠ never repeated; `--verbose` shows it
 *   again), a failed migration as ✗ with the fix, and a threshold below 0.5 as a hint.
 * The CLI never imports an IM layer (ADR 0054): the migration is read over the local gateway socket.
 */
import { createConfigDocument } from '@zhin.js/runtime';
import { hostGet, hostPost, type HostHttpConfig } from './host-http.js';

export interface AmbientJudgeCheckResult {
  name: string;
  status: 'ok' | 'info' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export const RETIRED_AMBIENT_TRIGGER_KEYS = Object.freeze(['minConfidence', 'mode'] as const);

/**
 * Deprecation window of the retired yml keys (ADR 0066 D5.6): a warning in the minor that ships the
 * merge and the next one; afterwards set this to `true` and doctor reports them as an error
 * (startup still only warns).
 */
export const RETIRED_AMBIENT_TRIGGER_KEYS_EXPIRED = false;

function retiredValuesOf(document: unknown): Readonly<Record<string, unknown>> {
  const ambient = (document as { ai?: { trigger?: { ambient?: Record<string, unknown> } } } | undefined)?.ai?.trigger?.ambient;
  if (!ambient || typeof ambient !== 'object') return {};
  return Object.fromEntries(RETIRED_AMBIENT_TRIGGER_KEYS.filter(key => Object.hasOwn(ambient, key)).map(key => [key, ambient[key]]));
}

/** The interjection judge of the running instance (`GET {base}/agent/inference/ambient-judge`). */
export interface AmbientJudgeView {
  readonly policy?: Readonly<{ minConfidence?: number; mode?: string }>;
  readonly source?: string;
  readonly chain?: readonly Readonly<{ profile: string; kind?: string }>[];
  readonly migration?: Readonly<{
    status: 'migrated' | 'failed' | 'reverted';
    at: number;
    rows?: readonly Readonly<{ field: string; value: unknown; from: string }>[];
    notes?: readonly Readonly<{ code: string; value?: unknown }>[];
    triggerKeys?: readonly string[];
    triggerValues?: Readonly<Record<string, unknown>>;
    triggerSeen?: Readonly<Record<string, unknown>>;
    /** The `purposes.ambient` the migration wrote. */
    after?: Readonly<Record<string, unknown>>;
    noticedAt?: number;
    revertedAt?: number;
    failure?: Readonly<{ reason: string; path?: string }>;
  }>;
}

/** Reads the running instance's judge view over the local socket; undefined when it is not reachable. */
export async function readAmbientJudgeView(client: HostHttpConfig | undefined): Promise<AmbientJudgeView | undefined> {
  if (!client) return undefined;
  const viewed = await hostGet<AmbientJudgeView>(client, '/ambient-judge').catch(() => undefined);
  return viewed?.ok && viewed.data ? viewed.data : undefined;
}

const NAME = '插话判断（旧配置项）';

/**
 * A retired key's value as the instance uses it (same rules as `legacyAmbientTriggerValues`):
 * `minConfidence` a finite number clamped to 0..1, `mode` `active` / `shadow`; anything else is
 * ignored at run time (undefined).
 */
export function normalizedTrigger(key: string, value: unknown): unknown {
  if (key === 'minConfidence') return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
  if (key === 'mode') return value === 'active' || value === 'shadow' ? value : undefined;
  return value;
}

/**
 * The retired keys in `configPath` (H1). They stop applying by themselves only once the running
 * instance's migration stored them (`migrated`, the key read by it and its value unchanged since):
 * only then are they reported as no longer applied and removed by `fix`. In every other state —
 * no instance reachable, not migrated yet, migration failed, reverted, or a value written after the
 * migration that the next load converts — they still apply: a warning, and `--fix` is refused.
 */
export async function checkRetiredAmbientTriggerKeys(input: Readonly<{
  configPath: string; label: string; fix?: boolean; expired?: boolean; view?: AmbientJudgeView;
}>): Promise<AmbientJudgeCheckResult> {
  const config = createConfigDocument(input.configPath);
  const snapshot = await config.read();
  const present = retiredValuesOf(snapshot.document);
  const keys = Object.keys(present);
  if (!keys.length) return { name: NAME, status: 'ok', message: `${input.label} 中没有已废弃的 ai.trigger.ambient.minConfidence / mode` };
  const names = (list: readonly string[]) => list.map(key => `ai.trigger.ambient.${key}`).join('、');
  const migration = input.view?.migration;
  const why = !input.view ? '无法连接运行中的实例，不能确认它们是否已迁移（请先 zhin start）'
    : !migration ? '实例还没有迁移它们，它们仍然生效'
      : migration.status === 'failed' ? '插话判断迁移失败，实例仍按它们运行'
        : migration.status === 'reverted' ? '插话判断迁移已回退，它们仍然生效' : undefined;
  if (why) {
    return { name: NAME, status: 'warn',
      message: `${input.label} 中的 ${names(keys)} 已废弃，但现在仍然生效：${why}。${input.fix ? '没有删除。' : ''}`,
      fix: '迁移完成后（zhin doctor 显示迁移记录）再运行 zhin doctor --fix；或在 Console「插话判断」设置后再删除' };
  }
  // Migrated: a value the instance has already acted on (its `triggerSeen`, or the value the
  // migration read and folded in), or one it ignores, no longer applies by itself. Both sides are
  // normalized as the instance does (N3); a value written since is converted on the next load.
  // The migration's own value counts only while the stored judge still holds what the migration
  // wrote for that key (R1: switched since, a write of the original value is a real change).
  const seen = migration!.triggerSeen ?? migration!.triggerValues ?? {};
  const original = migration!.triggerValues ?? {};
  const after = migration!.after ?? {};
  const policy = (input.view?.policy ?? {}) as Readonly<Record<string, unknown>>;
  const settled = keys.filter(key => {
    const value = normalizedTrigger(key, present[key]);
    return value === undefined || (Object.hasOwn(seen, key) && seen[key] === value)
      || (Object.hasOwn(original, key) && original[key] === value && policy[key] === after[key]);
  });
  const pending = keys.filter(key => !settled.includes(key));
  let removed: string[] = [];
  if (input.fix && settled.length) {
    const prepared = await config.prepare(snapshot, settled.map(key => ({ op: 'remove' as const, path: ['ai', 'trigger', 'ambient', key] })));
    await prepared.commit();
    const after = retiredValuesOf((await config.read()).document);
    removed = settled.filter(key => !Object.hasOwn(after, key));
  }
  const left = settled.filter(key => !removed.includes(key));
  const parts: string[] = [];
  if (removed.length) parts.push(`已从 ${input.label} 删除 ${names(removed)}（迁移时已读入插话判断 purposes.ambient）`);
  if (left.length) parts.push(`${input.label} 中的 ${names(left)} 已迁移到插话判断（purposes.ambient），不再单独生效`);
  if (pending.length) parts.push(`${names(pending)} 是迁移之后写入的，实例下次加载时会转到插话判断；${input.fix ? '没有删除，' : ''}请等它生效后再删除`);
  if (!left.length && !pending.length) return { name: NAME, status: 'ok', message: parts.join('；') };
  return {
    name: NAME,
    status: left.length && (input.expired ?? RETIRED_AMBIENT_TRIGGER_KEYS_EXPIRED) ? 'error' : 'warn',
    message: `${parts.join('；')}；门槛和「只观察」请在 Console「插话判断」设置`,
    fix: left.length ? 'zhin doctor --fix 删除已迁移的项' : '重启实例后再运行 zhin doctor',
  };
}

const NOTES: Readonly<Record<string, (value: unknown) => string>> = Object.freeze({
  'language-judge-became-fallback': value => `原「旁听」语言模型 ${String(value)} 成为第一个备用：决策模型失败时由它接手（以前直接不插话）`,
  'inherited-chat-not-added': () => '原「旁听」跟随部署聊天，没有把聊天模型自动加为备用；需要时在「插话判断」里添加',
  'threshold-max': value => `门槛取两道旧门槛中较大的值 ${String(value)}（行为不变）`,
  'shadow-threshold-dropped': value => `丢弃决策「仅评估」的 minConfidence ${String(value)}：它只影响陪跑记录，不影响插话`,
  'off-profile-not-migrated': value => `决策「关闭」的 Profile ${String(value)} 没有迁移（它从未被调用；Profile 本身保留）`,
});

const FAILURES: Readonly<Record<string, string>> = Object.freeze({
  'invalid-graph': '迁移结果校验不通过',
  'not-visible': '引用的 Profile 不属于 Host',
  conflict: '模型配置被并发修改（重试 3 次仍冲突）',
  'not-committed': '没有写入成功',
  unavailable: '模型配置存储不可用',
});

function time(at: number): string {
  return new Date(at).toISOString().replace('T', ' ').replace(/\.\d+Z$/u, ' UTC');
}

/**
 * Migration result of the running instance (D5.4): shown once (then marked `noticedAt`), again with
 * `verbose`; a failed migration is an error. Nothing when the instance is not reachable.
 */
export async function checkAmbientJudgeMigration(input: Readonly<{ client: HostHttpConfig | undefined; view?: AmbientJudgeView; verbose?: boolean }>): Promise<AmbientJudgeCheckResult[]> {
  if (!input.client) return [];
  const view = input.view ?? await readAmbientJudgeView(input.client);
  if (!view) return [];
  const results: AmbientJudgeCheckResult[] = [];
  const migration = view.migration;
  if (migration?.status === 'failed') {
    results.push({
      name: '插话判断迁移',
      status: 'error',
      message: `旧插话配置迁移失败（${FAILURES[migration.failure?.reason ?? ''] ?? migration.failure?.reason ?? '未知原因'}${migration.failure?.path ? `，位置 ${migration.failure.path}` : ''}）；实例暂按旧配置在内存中换算运行，插话行为不变`,
      fix: migration.failure?.path
        ? `修正 ${migration.failure.path} 引用的模型（Console「模型」或「插话判断」），下次加载自动重试`
        : '检查模型配置后重启实例，下次加载自动重试',
    });
  } else if (migration?.status === 'migrated' && (migration.noticedAt === undefined || input.verbose)) {
    const rows = (migration.rows ?? []).map(row => `${row.field} = ${Array.isArray(row.value) ? row.value.join(', ') : String(row.value)}（来自 ${row.from}）`);
    const notes = (migration.notes ?? []).map(note => NOTES[note.code]?.(note.value) ?? note.code);
    results.push({
      name: '插话判断迁移',
      status: 'info',
      message: [`${time(migration.at)} 已把「旁听」用途和「旁听参与判断」合并为插话判断 purposes.ambient：`,
        ...(rows.length ? rows : ['（没有单独的设置，沿用默认值）']).map(line => `  · ${line}`),
        ...notes.map(line => `  · ${line}`),
        ...(migration.triggerKeys?.length ? [`  · 读入了 ${migration.triggerKeys.join('、')}，之后它们不再生效`] : []),
      ].join('\n'),
      fix: '降级到旧版本前先运行 zhin ai purposes revert ambient-judge',
    });
    if (migration.noticedAt === undefined) await hostPost(input.client, '/ambient-judge/migration/noticed', {}).catch(() => undefined);
  } else if (migration?.status === 'reverted' && input.verbose) {
    results.push({ name: '插话判断迁移', status: 'info', message: `插话判断迁移已于 ${time(migration.revertedAt ?? migration.at)} 回退，当前按旧配置换算运行` });
  }
  const threshold = view.policy?.minConfidence;
  if (threshold !== undefined && threshold < 0.5) {
    results.push({
      name: '插话判断门槛',
      status: 'info',
      message: `purposes.ambient.minConfidence 为 ${threshold}：决策模型二选一时选「插话」本身就意味着概率 ≥ 0.5，低于 0.5 的门槛对决策模型等于没设`,
    });
  }
  return results;
}
