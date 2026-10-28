/**
 * `change_draft`（ADR 0040 §2，切片 B）：模型只能**起草**一次受控自我变更，不能让它生效。
 *
 * - `risk: 'safe'`：草稿由宿主写进 `.zhin/changes/<id>/files/`（暂存区，不在生产目录）；只能新建或改
 *   **自己发起的** `draft`。路径白名单、禁止的配置键、配额都由 `SelfChangeStore` 在写盘前校验。
 * - 写入后宿主生成预览（diff 摘要 + `InvalidationPlanner` 影响面 + 配置补丁重载级别）并挂到草稿上，
 *   作为后续试跑（切片 C）与审批卡（切片 D）的展示内容。
 * - 随后宿主自动试跑（§3）：通过 → `ready`；失败 → `trial_failed`（终态），错误交回模型重新起草。
 * - 只在 IM 会话里可用：审计与回报需要发起会话与发起人。
 */
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import { MAX_CHANGE_FILES } from '../self-change/policy.js';
import {
  buildSelfChangePreview,
  describeSelfChangeImpact,
  type SelfChangeImpactPort,
  type SelfChangePreview,
} from '../self-change/preview.js';
import type { SelfChangeDraftFile, SelfChangeRecord, SelfChangeStore } from '../self-change/store.js';
import { runSelfChangeTrial, type SelfChangeTrialOptions, type SelfChangeTrialResult } from '../self-change/trial.js';

export const SELF_CHANGE_DRAFT_TOOL_NAME = 'change_draft';

export interface NativeSelfChangeToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

export interface NativeSelfChangeToolSources {
  readonly store: () => SelfChangeStore | undefined;
  /** 影响面判定；缺省时按保守估计（文件 → 热重载，配置 → 重启）。 */
  readonly impact?: () => SelfChangeImpactPort | undefined;
  /** 试跑选项（JSX 语法检查器、插件根）。 */
  readonly trial?: () => SelfChangeTrialOptions | undefined;
}

export function createNativeSelfChangeToolFeatures(sources: NativeSelfChangeToolSources): readonly NativeSelfChangeToolFeature[] {
  return Object.freeze([
    Object.freeze({
      feature: toolFeatureId,
      name: SELF_CHANGE_DRAFT_TOOL_NAME,
      definition: defineAgentTool<Record<string, unknown>, string>({
        description: 'Draft a change to this bot itself when the user asks you to add/modify a command, handler, tool, skill, '
          + 'AGENTS.md, or a config field (e.g. "add a /ping command that replies pong"). The change is only STAGED: it is '
          + 'not live until the host trial-runs it and the owner approves it. Writable: plugin convention dirs '
          + '(commands/, middlewares/, handlers/, tools/, components/, skills/, agents/), root AGENTS.md, skills/**. '
          + 'Root config files only via config_patch; lockfiles, node_modules, .env*, .zhin/** and security settings '
          + '(ai.agent.toolHardGate, execApprovalMode, masterShell) are always refused. The host trial-runs the draft right away '
          + '(syntax, default export, forbidden imports, SKILL.md, then loading it in an offline trial runtime); a failed trial closes it and you start a new change. '
          + 'Never write these files with other tools.',
        inputSchema: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            change_id: Object.freeze({
              type: 'string',
              description: 'Id of your own change still in draft to revise. Usually omit: every call starts a new change.',
            }),
            files: Object.freeze({
              type: 'array',
              maxItems: MAX_CHANGE_FILES,
              description: 'Complete new content per target file (paths relative to the project root), or delete: true.',
              items: Object.freeze({
                type: 'object',
                properties: Object.freeze({
                  path: Object.freeze({ type: 'string' }),
                  content: Object.freeze({ type: 'string' }),
                  delete: Object.freeze({ type: 'boolean' }),
                }),
                required: Object.freeze(['path']),
              }),
            }),
            config_patch: Object.freeze({
              type: 'object',
              description: 'Field-level config edits. expected_revision is the config revision you read.',
              properties: Object.freeze({
                expected_revision: Object.freeze({ type: 'string' }),
                patches: Object.freeze({
                  type: 'array',
                  items: Object.freeze({
                    type: 'object',
                    properties: Object.freeze({
                      op: Object.freeze({ type: 'string', enum: Object.freeze(['set', 'remove']) }),
                      path: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) }),
                      value_json: Object.freeze({ type: 'string', description: 'JSON-encoded new value for op=set, e.g. "true", "30", "\\"zh-CN\\"".' }),
                    }),
                    required: Object.freeze(['op', 'path']),
                  }),
                }),
              }),
              required: Object.freeze(['expected_revision', 'patches']),
            }),
            summary: Object.freeze({
              type: 'string',
              maxLength: 200,
              description: 'One sentence describing the change for the approval card, in the user\'s language.',
            }),
          }),
          required: Object.freeze(['summary']),
        }),
        requiresApproval: 'never',
        risk: 'safe',
        execute: async (input, context) => draftSelfChange(sources, input, context),
      }) as Readonly<AgentToolDefinition<Record<string, unknown>, string>>,
    }),
  ]);
}

async function draftSelfChange(
  sources: NativeSelfChangeToolSources,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<string> {
  const store = sources.store();
  if (!store) throw new Error('self-change drafts are unavailable');
  const origin = context.origin;
  if (origin.kind !== 'im') throw new TypeError('change_draft only works inside an IM conversation');
  const userId = context.principal?.subjectId?.trim() || '';
  if (!userId) throw new TypeError('change_draft needs a known requester');
  const files = Array.isArray(input.files) ? input.files.map(toDraftFile) : [];
  const configPatch = toConfigPatch(input.config_patch);
  const changeId = typeof input.change_id === 'string' && input.change_id.trim() ? input.change_id.trim() : undefined;
  const record = await store.draft({
    ...(changeId ? { id: changeId } : {}),
    origin: { platform: origin.platform, sceneId: `${origin.scope}:${origin.sceneId}`, userId, endpoint: origin.endpoint },
    files,
    ...(configPatch !== undefined ? { configPatch } : {}),
    actor: 'model',
    turnId: context.turnId,
  });
  const preview = await buildSelfChangePreview({
    projectRoot: store.projectRoot,
    contentHash: record.contentHash,
    files: record.files,
    configPatch: record.configPatch,
    readStaged: target => store.readStagedFile(record.id, target),
    impact: sources.impact?.(),
    summary: typeof input.summary === 'string' ? input.summary : null,
  });
  await store.attachPlan(record.id, record.contentHash, preview);
  const trialed = await runSelfChangeTrial(store, record.id, { ...(sources.trial?.() ?? {}), turnId: context.turnId });
  return describeDraft(trialed, preview);
}

function toDraftFile(raw: unknown): SelfChangeDraftFile {
  const file = (raw && typeof raw === 'object' ? raw : {}) as { path?: unknown; content?: unknown; delete?: unknown };
  const target = typeof file.path === 'string' ? file.path : '';
  if (file.delete === true) return { path: target, delete: true };
  // 缺 content 交给存储报错（`content must be a string`），这里不猜。
  return typeof file.content === 'string' ? { path: target, content: file.content } : { path: target };
}

/**
 * 工具入参用蛇形命名、`value_json` 传值（JSON Schema 要求每个节点有 `type`，任意值只能编码成字符串）；
 * 存储沿用 Console `config:patch` 的 `expectedRevision` / `patches` / `value`。形状校验交给存储。
 */
function toConfigPatch(raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') return raw;
  const value = raw as { expected_revision?: unknown; expectedRevision?: unknown; patches?: unknown };
  const patches = Array.isArray(value.patches) ? value.patches.map(toConfigOperation) : value.patches;
  return { expectedRevision: value.expected_revision ?? value.expectedRevision, patches };
}

function toConfigOperation(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const { value_json: encoded, ...rest } = raw as { value_json?: unknown; [key: string]: unknown };
  if (encoded === undefined || rest.op !== 'set' || 'value' in rest) return rest;
  if (typeof encoded !== 'string') throw new TypeError('config_patch value_json must be a JSON string');
  try {
    return { ...rest, value: JSON.parse(encoded) as unknown };
  } catch {
    throw new TypeError(`config_patch value_json is not valid JSON: ${encoded.slice(0, 80)}`);
  }
}

function describeDraft(record: SelfChangeRecord, preview: SelfChangePreview): string {
  const lines = preview.files.map((file) => {
    const counts = file.kind === 'delete' ? `-${file.removed}` : `+${file.added} -${file.removed}`;
    return `- ${file.kind} ${file.path} (${counts}${file.truncated ? ', not compared' : ''})`;
  });
  if (record.configPatch) {
    lines.push(`- config: ${record.configPatch.patches.map(patch => `${patch.op} ${patch.path.join('.')}`).join(', ')}`);
  }
  const impact = `Impact: ${describeSelfChangeImpact(preview.impact)}.`;
  if (record.status === 'trial_failed') {
    return [
      `Change draft ${record.id} FAILED its trial run and is closed; nothing was applied and no approval was requested.`,
      ...lines,
      'Problems:',
      ...(record.error ?? 'trial failed').split('\n').map(line => `- ${line}`),
      'Fix the problems and call change_draft again WITHOUT change_id (start a new change) with the full file list. '
        + 'Do not write these files with other tools.',
    ].join('\n');
  }
  const trial = record.trial as SelfChangeTrialResult | null;
  const skipped = trial?.checks.filter(check => check.status === 'skipped').length ?? 0;
  const loaded = trial?.checks.some(check => check.check === 'sandbox_load' && check.status === 'passed') ?? false;
  return [
    `Change draft ${record.id} saved (revision ${record.revision}) and passed the ${loaded ? 'trial run (static checks + trial-runtime load)' : 'static trial run'}${skipped ? ` (${skipped} check(s) skipped)` : ''}. `
      + 'It is NOT live: it is staged outside the project and still needs the owner\'s approval.',
    ...lines,
    impact,
    'Tell the user briefly what was drafted and that it is waiting; do not claim it is active and do not write these files with other tools. '
      + 'To change it further, call change_draft again WITHOUT change_id (start a new change) with the full file list.',
  ].join('\n');
}
