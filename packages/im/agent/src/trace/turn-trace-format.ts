/** Human-readable terminal rendering of a TurnTrace for `zhin trace`. */
import { turnTraceTotalUsage, type TurnTrace, type TurnTraceToolCall, type TurnTraceTrigger } from './turn-trace.js';
import { CONTEXT_BUDGET_SEGMENTS, type ContextBudgetReport, type ContextBudgetSegment } from './context-budget.js';

const STATUS_LABEL: Record<TurnTrace['termination']['status'], string> = {
  running: '进行中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
  budget_exceeded: '超出预算',
  unknown: '未知',
};

const TOOL_MARK: Record<TurnTraceToolCall['status'], string> = {
  running: '…',
  ok: '✓',
  failed: '✗',
  denied: '⊘',
  cancelled: '-',
};

export interface FormatTurnTraceOptions {
  /** Include the chronological timeline (default true). */
  readonly timeline?: boolean;
  /**
   * Display name of a recorded provider id (`services:` / `accounts:` graph id → the service
   * label people configured, #1250). Unknown ids fall back to the model name alone.
   */
  readonly providerLabel?: (provider: string) => string | undefined;
}

export function formatTurnTrace(trace: TurnTrace, options: FormatTurnTraceOptions = {}): string {
  return renderTrace(trace, '', options.timeline ?? true, options.providerLabel).join('\n');
}

/** `服务名 · 模型` when the provider has a display name; graph ids alone never reach a reader. */
function modelDisplay(provider: string | undefined, model: string, label?: (provider: string) => string | undefined): string {
  const name = provider ? safeLabel(label, provider) : undefined;
  if (name) return `${name} · ${model}`;
  // Graph ids (`services:<uuid>` / `accounts:<uuid>`) mean nothing to a reader; show the model alone then.
  const opaque = !provider || /^(services|accounts|profiles):/u.test(provider);
  return opaque ? model : `${provider}/${model}`;
}

function safeLabel(label: ((provider: string) => string | undefined) | undefined, provider: string): string | undefined {
  try {
    return label?.(provider)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function timelineDetail(entry: TurnTrace['timeline'][number], label?: (provider: string) => string | undefined): string {
  if (entry.kind !== 'model_request') return entry.detail;
  const match = /^(#\d+) ([^/\s]+)\/(.+)$/u.exec(entry.detail);
  return match ? `${match[1]} ${modelDisplay(match[2], match[3]!, label)}` : entry.detail;
}

/** One line per trace, newest last. */
export function formatTurnTraceList(traces: readonly TurnTrace[]): string {
  if (traces.length === 0) return '还没有记录到任何回合。';
  return traces.map(trace => [
    new Date(trace.started_at).toLocaleString(),
    STATUS_LABEL[trace.termination.status],
    trace.turn_id,
    trace.session_key,
    `${trace.tool_calls.length} tools`,
    trace.subagent_usage?.model_calls
      ? `${turnTraceTotalUsage(trace).total_tokens} tokens (子 agent ${trace.subagent_usage.total_tokens})`
      : `${trace.usage.total_tokens} tokens`,
  ].join('  ')).join('\n');
}

function renderTrace(
  trace: TurnTrace,
  indent: string,
  withTimeline: boolean,
  providerLabel?: (provider: string) => string | undefined,
): string[] {
  const lines: string[] = [];
  const termination = trace.termination;
  const failingTool = trace.tool_calls.find(tool => tool.status === 'failed' || tool.status === 'denied');
  lines.push(`${indent}回合 ${trace.turn_id}  [${STATUS_LABEL[termination.status]}]`);
  lines.push(`${indent}  会话: ${trace.session_key}`);
  if (trace.principal) {
    const name = trace.principal.display_name ? ` (${trace.principal.display_name})` : '';
    lines.push(`${indent}  发起人: ${trace.principal.subject_id}${name}  角色: ${trace.principal.roles.join(', ') || '-'}`
      + (trace.principal.trust_level ? `  信任级别: ${trace.principal.trust_level}` : ''));
  }
  if (trace.trigger) lines.push(...renderTrigger(trace.trigger, indent));
  lines.push(`${indent}  开始: ${new Date(trace.started_at).toLocaleString()}  耗时: ${formatDuration(trace.duration_ms)}`);
  if (termination.code || termination.reason) {
    lines.push(`${indent}  结束原因: ${[termination.code, termination.reason].filter(Boolean).join(' — ')}`);
  }
  if (failingTool) {
    lines.push(`${indent}  首个失败步骤: ${failingTool.tool_name} ${failingTool.status}${failingTool.error ? ` — ${failingTool.error}` : ''}`);
  }

  const sub = trace.subagent_usage;
  if (sub && sub.model_calls > 0) {
    // #1250: the parent total includes its sub-agents; say how much is whose.
    const total = turnTraceTotalUsage(trace);
    lines.push(`${indent}  模型调用 ${total.model_calls} 次（自身 ${trace.model_calls.length}，子 agent ${sub.model_calls}），tokens 输入 ${total.prompt_tokens} / 输出 ${total.completion_tokens} / 合计 ${total.total_tokens}（自身 ${trace.usage.total_tokens}，子 agent ${sub.total_tokens}）`);
  } else {
    lines.push(`${indent}  模型调用 ${trace.model_calls.length} 次，tokens 输入 ${trace.usage.prompt_tokens} / 输出 ${trace.usage.completion_tokens} / 合计 ${trace.usage.total_tokens}`);
  }
  const cached = trace.model_calls.reduce((sum, call) => sum + (call.cache_read_tokens ?? 0), 0);
  if (cached > 0 && trace.usage.prompt_tokens > 0) {
    lines.push(`${indent}  提示缓存命中 ${cached} tokens（占输入 ${Math.round((cached / trace.usage.prompt_tokens) * 100)}%）`);
  }
  for (const call of trace.model_calls) {
    const cache = call.cache_read_tokens ? ` cache=${call.cache_read_tokens}` : '';
    const reasoning = call.reasoning_tokens ? ` reasoning=${call.reasoning_tokens}` : '';
    const cacheWrite = call.cache_write_tokens !== undefined ? ` cache_write=${call.cache_write_tokens}` : '';
    const model = call.model ? ` model=${modelDisplay(call.provider, call.model, providerLabel)}` : '';
    lines.push(`${indent}    #${call.index} in=${call.prompt_tokens} out=${call.completion_tokens}${cache}${reasoning}${cacheWrite}${model}`);
  }

  if (trace.context_budget) lines.push(...renderContextBudget(trace.context_budget, indent));

  lines.push(`${indent}  工具调用 ${trace.tool_calls.length} 次`);
  for (const tool of trace.tool_calls) {
    const details = [
      tool.duration_ms !== undefined ? `${tool.duration_ms}ms` : undefined,
      tool.result_size !== undefined ? `${tool.result_size} 字符` : undefined,
      tool.policy ? `策略 ${tool.policy}` : undefined,
    ].filter(Boolean).join(', ');
    lines.push(`${indent}    ${TOOL_MARK[tool.status]} ${tool.tool_name}${details ? ` (${details})` : ''} ${tool.args_summary}`.trimEnd());
    if (tool.error) lines.push(`${indent}      ${tool.error}`);
  }

  if (trace.budget.extensions.length > 0 || trace.budget.continuations > 0) {
    const extensions = trace.budget.extensions.map(item => `${item.from}→${item.to}`).join(', ');
    lines.push(`${indent}  预算: 延长 ${trace.budget.extensions.length} 次${extensions ? ` (${extensions})` : ''}，自动续跑 ${trace.budget.continuations} 次`);
  }

  for (const child of trace.subagents) {
    lines.push(`${indent}  子 agent:`);
    lines.push(...renderTrace(child, `${indent}    `, false, providerLabel));
  }

  if (withTimeline && trace.timeline.length > 0) {
    lines.push(`${indent}  时间线:`);
    const waited = trace.trigger?.wait_before_start_ms;
    if (waited !== undefined && waited > 0) {
      lines.push(`${indent}    -${formatDuration(waited).padStart(7)}  ${'received'.padEnd(14)} 收到触发消息`);
    }
    for (const entry of trace.timeline) {
      lines.push(`${indent}    +${formatDuration(entry.at_ms).padStart(7)}  ${entry.kind.padEnd(14)} ${timelineDetail(entry, providerLabel)}`.trimEnd());
    }
  }
  if (trace.dropped > 0) lines.push(`${indent}  (有 ${trace.dropped} 条记录因超出上限被省略)`);
  return lines;
}

/** Who triggered the turn and how long the message waited before the turn began (#1250). */
function renderTrigger(trigger: TurnTraceTrigger, indent: string): string[] {
  const sender = trigger.sender_id
    ? `  发送者: ${trigger.sender_id}${trigger.sender_name ? ` (${trigger.sender_name})` : ''}` : '';
  const conversation = trigger.conversation ? `  会话: ${trigger.conversation}` : '';
  const lines = [`${indent}  触发消息: ${JSON.stringify(trigger.text)}${sender}${conversation}`];
  if (trigger.wait_before_start_ms !== undefined) {
    const details = [
      trigger.merged_messages !== undefined && trigger.merged_messages > 1 ? `合流 ${trigger.merged_messages} 条消息` : undefined,
      trigger.queued_ms ? `排队等待前一回合 ${formatDuration(trigger.queued_ms)}` : undefined,
    ].filter(Boolean).join('，');
    lines.push(`${indent}  收到 → 回合开始: ${formatDuration(trigger.wait_before_start_ms)}${details ? `（${details}）` : ''}`);
  }
  return lines;
}

const SEGMENT_LABEL: Record<ContextBudgetSegment, string> = {
  system: '系统提示',
  tool_schemas: '工具 schema',
  output_schema: '输出 schema',
  tool_index: '按需工具索引',
  skill_catalog: '技能目录',
  agent_catalog: '专家 agent 目录',
  active_skills: '已加载技能',
  memory: '记忆',
  bootstrap: 'bootstrap',
  history: '历史消息',
  user: '本轮输入',
};

const TOP_SECTIONS = 5;

/** Estimated prompt cost of the first model request, by segment. */
function renderContextBudget(budget: ContextBudgetReport, indent: string): string[] {
  const parts = CONTEXT_BUDGET_SEGMENTS
    .filter(segment => budget.segments[segment] > 0)
    .map(segment => `${SEGMENT_LABEL[segment]} ${budget.segments[segment]}`);
  const lines = [
    `${indent}  上下文估算 ~${budget.total_tokens} tokens（固定开销 ~${budget.fixed_tokens}；工具 ${budget.tools.loaded} 个常驻 / ${budget.tools.deferred} 个按需）`,
  ];
  if (parts.length > 0) lines.push(`${indent}    ${parts.join(' · ')}`);
  const top = budget.sections.slice(0, TOP_SECTIONS).filter(section => section.tokens > 0);
  if (top.length > 0) lines.push(`${indent}    最大的提示段: ${top.map(section => `${section.id}${section.kind ? `[${section.kind} w${section.weight ?? 0}]` : ''} ${section.tokens}${section.trimmed ? ' (已裁剪)' : ''}`).join(', ')}`);
  if (budget.bootstrap_skipped?.length) lines.push(`${indent}    bootstrap 按场景跳过: ${budget.bootstrap_skipped.join(' / ')}`);
  return lines;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}
