/** Human-readable terminal rendering of a TurnTrace for `zhin trace`. */
import type { TurnTrace, TurnTraceToolCall } from './turn-trace.js';
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
}

export function formatTurnTrace(trace: TurnTrace, options: FormatTurnTraceOptions = {}): string {
  return renderTrace(trace, '', options.timeline ?? true).join('\n');
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
    `${trace.usage.total_tokens} tokens`,
  ].join('  ')).join('\n');
}

function renderTrace(trace: TurnTrace, indent: string, withTimeline: boolean): string[] {
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
  lines.push(`${indent}  开始: ${new Date(trace.started_at).toLocaleString()}  耗时: ${formatDuration(trace.duration_ms)}`);
  if (termination.code || termination.reason) {
    lines.push(`${indent}  结束原因: ${[termination.code, termination.reason].filter(Boolean).join(' — ')}`);
  }
  if (failingTool) {
    lines.push(`${indent}  首个失败步骤: ${failingTool.tool_name} ${failingTool.status}${failingTool.error ? ` — ${failingTool.error}` : ''}`);
  }

  lines.push(`${indent}  模型调用 ${trace.model_calls.length} 次，tokens 输入 ${trace.usage.prompt_tokens} / 输出 ${trace.usage.completion_tokens} / 合计 ${trace.usage.total_tokens}`);
  const cached = trace.model_calls.reduce((sum, call) => sum + (call.cache_read_tokens ?? 0), 0);
  if (cached > 0 && trace.usage.prompt_tokens > 0) {
    lines.push(`${indent}  提示缓存命中 ${cached} tokens（占输入 ${Math.round((cached / trace.usage.prompt_tokens) * 100)}%）`);
  }
  for (const call of trace.model_calls) {
    const cache = call.cache_read_tokens ? ` cache=${call.cache_read_tokens}` : '';
    const reasoning = call.reasoning_tokens ? ` reasoning=${call.reasoning_tokens}` : '';
    const cacheWrite = call.cache_write_tokens !== undefined ? ` cache_write=${call.cache_write_tokens}` : '';
    const model = call.model ? ` model=${call.provider ?? '?'}/${call.model}` : '';
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

  for (const task of trace.subagent_tasks) {
    lines.push(`${indent}  子任务 ${task.task_id} [${task.status}] ${task.description}`);
  }
  for (const child of trace.subagents) {
    lines.push(`${indent}  子 agent:`);
    lines.push(...renderTrace(child, `${indent}    `, false));
  }

  if (withTimeline && trace.timeline.length > 0) {
    lines.push(`${indent}  时间线:`);
    for (const entry of trace.timeline) {
      lines.push(`${indent}    +${formatDuration(entry.at_ms).padStart(7)}  ${entry.kind.padEnd(14)} ${entry.detail}`.trimEnd());
    }
  }
  if (trace.dropped > 0) lines.push(`${indent}  (有 ${trace.dropped} 条记录因超出上限被省略)`);
  return lines;
}

const SEGMENT_LABEL: Record<ContextBudgetSegment, string> = {
  system: '系统提示',
  tool_schemas: '工具 schema',
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
  if (top.length > 0) lines.push(`${indent}    最大的提示段: ${top.map(section => `${section.id} ${section.tokens}`).join(', ')}`);
  return lines;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}
