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

function retiredKeysOf(document: unknown): readonly string[] {
  const ambient = (document as { ai?: { trigger?: { ambient?: Record<string, unknown> } } } | undefined)?.ai?.trigger?.ambient;
  if (!ambient || typeof ambient !== 'object') return [];
  return RETIRED_AMBIENT_TRIGGER_KEYS.filter(key => Object.hasOwn(ambient, key));
}

/** The retired keys in `configPath`; with `fix`, removes them (other keys untouched). */
export async function checkRetiredAmbientTriggerKeys(input: Readonly<{ configPath: string; label: string; fix?: boolean; expired?: boolean }>): Promise<AmbientJudgeCheckResult> {
  const config = createConfigDocument(input.configPath);
  let snapshot = await config.read();
  let keys = retiredKeysOf(snapshot.document);
  if (keys.length && input.fix) {
    const prepared = await config.prepare(snapshot, keys.map(key => ({ op: 'remove' as const, path: ['ai', 'trigger', 'ambient', key] })));
    await prepared.commit();
    snapshot = await config.read();
    const remaining = retiredKeysOf(snapshot.document);
    if (!remaining.length) {
      return { name: '插话判断（旧配置项）', status: 'ok', message: `已从 ${input.label} 删除 ${keys.map(key => `ai.trigger.ambient.${key}`).join('、')}（已迁移到插话判断 purposes.ambient）` };
    }
    keys = remaining;
  }
  if (!keys.length) return { name: '插话判断（旧配置项）', status: 'ok', message: `${input.label} 中没有已废弃的 ai.trigger.ambient.minConfidence / mode` };
  return {
    name: '插话判断（旧配置项）',
    status: (input.expired ?? RETIRED_AMBIENT_TRIGGER_KEYS_EXPIRED) ? 'error' : 'warn',
    message: `${input.label} 中的 ${keys.map(key => `ai.trigger.ambient.${key}`).join('、')} 已废弃且不再生效：门槛和「只观察」改在 Console「插话判断」（purposes.ambient）设置；升级时已迁移一次`,
    fix: 'zhin doctor --fix 删除这两项',
  };
}

interface AmbientJudgeView {
  readonly policy?: Readonly<{ minConfidence?: number }>;
  readonly chain?: readonly Readonly<{ profile: string; kind?: string }>[];
  readonly migration?: Readonly<{
    status: 'migrated' | 'failed' | 'reverted';
    at: number;
    rows?: readonly Readonly<{ field: string; value: unknown; from: string }>[];
    notes?: readonly Readonly<{ code: string; value?: unknown }>[];
    triggerKeys?: readonly string[];
    noticedAt?: number;
    revertedAt?: number;
    failure?: Readonly<{ reason: string; path?: string }>;
  }>;
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
export async function checkAmbientJudgeMigration(input: Readonly<{ client: HostHttpConfig | undefined; verbose?: boolean }>): Promise<AmbientJudgeCheckResult[]> {
  if (!input.client) return [];
  const viewed = await hostGet<AmbientJudgeView>(input.client, '/ambient-judge').catch(() => undefined);
  if (!viewed?.ok || !viewed.data) return [];
  const results: AmbientJudgeCheckResult[] = [];
  const migration = viewed.data.migration;
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
  const threshold = viewed.data.policy?.minConfidence;
  if (threshold !== undefined && threshold < 0.5) {
    results.push({
      name: '插话判断门槛',
      status: 'info',
      message: `purposes.ambient.minConfidence 为 ${threshold}：决策模型二选一时选「插话」本身就意味着概率 ≥ 0.5，低于 0.5 的门槛对决策模型等于没设`,
    });
  }
  return results;
}
