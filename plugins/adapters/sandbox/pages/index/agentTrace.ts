import { getSandboxApiBase, getSandboxAuthHeaders } from './sandboxTransport.js';

export type SandboxScope = 'private' | 'group' | 'channel';

export interface AgentTraceEvent {
  readonly runtimeId?: string;
  readonly sequence: number;
  readonly recordedAt: number;
  readonly sessionKey: string;
  readonly turnId: string;
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export interface AgentTraceSnapshot {
  readonly runtimeId?: string;
  readonly sessionKey: string;
  readonly events: readonly AgentTraceEvent[];
  readonly latestSequence: number;
  readonly activeTurnIds: readonly string[];
}

export interface AgentTraceSummary {
  readonly eventCount: number;
  readonly toolCount: number;
  readonly tokenCount: number;
  readonly problemCount: number;
  readonly activeTurns: number;
}

export interface AgentTraceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type AgentTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentRunIdentity {
  readonly runtimeId?: string;
  readonly turnId: string;
}

export interface AgentTaskRun extends AgentRunIdentity {
  readonly id: string;
  readonly sourceMessageId?: string;
  readonly status: AgentTaskStatus;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
  readonly eventCount: number;
  readonly toolCount: number;
  readonly tokenCount: number;
  readonly problemCount: number;
}

export interface WorkbenchArtifact {
  readonly id: string;
  readonly runtimeId?: string;
  readonly turnId: string;
  readonly kind: 'file-change' | 'test' | 'command';
  readonly title: string;
  readonly path?: string;
  readonly status: 'running' | 'completed' | 'failed' | 'denied' | 'cancelled';
  readonly detail?: string;
  readonly diff?: string;
  readonly durationMs?: number;
  readonly recordedAt: number;
}

export type AgentRunStepStatus = 'running' | 'completed' | 'failed' | 'denied' | 'cancelled';

export interface AgentRunStep {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly status: AgentRunStepStatus;
  readonly recordedAt: number;
  readonly durationMs?: number;
}

export interface AgentRunReportContext {
  readonly run?: AgentRunIdentity;
  readonly sessionName?: string;
  readonly taskPrompt?: string;
  readonly workingDirectory?: string;
  readonly safetyMode?: string;
  readonly approvalMode?: string;
  readonly networkAccess?: boolean;
}

const problemTypes = new Set(['tool_denied', 'tool_failed', 'tool_cancelled', 'turn_cancelled', 'budget_exceeded', 'error']);
const toolTypes = new Set(['tool_call', 'mcp_tool_call']);
const terminalTypes = new Set(['turn_end', 'turn_cancelled', 'budget_exceeded', 'error']);
const toolTerminalTypes = new Set(['tool_result', 'tool_denied', 'tool_failed', 'tool_cancelled']);
const traceCachePrefix = 'zhin.sandbox.agent-trace.v1:';

export function buildSandboxSessionKey(endpointId: string, scope: SandboxScope, sceneId: string): string {
  return `sandbox:${endpointId || 'sandbox-bot'}:${scope}:${sceneId}`;
}

export function agentStudioPath(sessionKey: string): string {
  const params = new URLSearchParams({ sessionKey });
  return `/agent/studio?${params}`;
}

export function mergeTraceSnapshot(
  previous: AgentTraceSnapshot | null,
  incoming: AgentTraceSnapshot,
): AgentTraceSnapshot {
  if (!previous || previous.sessionKey !== incoming.sessionKey) return incoming;
  const events = [...previous.events, ...incoming.events]
    .filter((event, index, all) => all.findIndex((candidate) => (
      candidate.runtimeId === event.runtimeId
      && candidate.turnId === event.turnId
      && candidate.sequence === event.sequence
    )) === index)
    .sort((left, right) => left.recordedAt - right.recordedAt || left.sequence - right.sequence)
    .slice(-300);
  return { ...incoming, events };
}

export function loadCachedAgentTrace(
  sessionKey: string,
  storage: AgentTraceStorage | undefined = browserTraceStorage(),
): AgentTraceSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${traceCachePrefix}${sessionKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.sessionKey !== sessionKey || !Array.isArray(parsed.events)) return null;
    const events = parsed.events.map(parseCachedTraceEvent)
      .filter((event): event is AgentTraceEvent => event != null)
      .slice(-300);
    const activeTurnIds = Array.isArray(parsed.activeTurnIds)
      ? parsed.activeTurnIds.filter((value): value is string => typeof value === 'string').slice(-20)
      : [];
    return {
      ...(typeof parsed.runtimeId === 'string' ? { runtimeId: parsed.runtimeId } : {}),
      sessionKey,
      events,
      latestSequence: nonNegativeNumber(parsed.latestSequence),
      activeTurnIds,
    };
  } catch {
    return null;
  }
}

export function saveCachedAgentTrace(
  snapshot: AgentTraceSnapshot,
  storage: AgentTraceStorage | undefined = browserTraceStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(`${traceCachePrefix}${snapshot.sessionKey}`, JSON.stringify({
      ...snapshot,
      events: snapshot.events.slice(-300),
      activeTurnIds: snapshot.activeTurnIds.slice(-20),
    }));
    return true;
  } catch {
    return false;
  }
}

export function summarizeTrace(snapshot: AgentTraceSnapshot | null): AgentTraceSummary {
  if (!snapshot) return { eventCount: 0, toolCount: 0, tokenCount: 0, problemCount: 0, activeTurns: 0 };
  return {
    eventCount: snapshot.latestSequence,
    toolCount: snapshot.events.filter((event) => toolTypes.has(event.type)).length,
    tokenCount: snapshot.events
      .filter((event) => event.type === 'usage')
      .reduce((total, event) => total + usageTotal(event.data), 0),
    problemCount: snapshot.events.filter((event) => problemTypes.has(event.type)).length,
    activeTurns: snapshot.activeTurnIds.length,
  };
}

export function deriveTaskRuns(snapshot: AgentTraceSnapshot | null): AgentTaskRun[] {
  if (!snapshot) return [];
  const active = new Set(snapshot.activeTurnIds);
  const byRun = new Map<string, AgentTraceEvent[]>();
  for (const event of snapshot.events) {
    const key = runCorrelationKey(event);
    const events = byRun.get(key) ?? [];
    events.push(event);
    byRun.set(key, events);
  }
  return [...byRun.entries()].map(([id, events]) => {
    const identity = events[0]!;
    const turnId = identity.turnId;
    const runtimeId = identity.runtimeId;
    const startedAt = events.find((event) => event.type === 'turn_start')?.recordedAt ?? events[0]?.recordedAt ?? 0;
    const terminal = [...events].reverse().find((event) => terminalTypes.has(event.type));
    const sourceMessageId = stringValue(events.find((event) => event.type === 'turn_start')?.data.sourceMessageId);
    const belongsToCurrentRuntime = snapshot.runtimeId === undefined || runtimeId === snapshot.runtimeId;
    const status: AgentTaskStatus = belongsToCurrentRuntime && active.has(turnId)
      ? 'running'
      : terminal?.type === 'turn_end'
        ? 'completed'
        : terminal?.type === 'turn_cancelled'
          ? 'cancelled'
          : terminal
            ? 'failed'
            : 'failed';
    const endedAt = terminal?.recordedAt;
    return {
      id,
      ...(runtimeId ? { runtimeId } : {}),
      ...(sourceMessageId ? { sourceMessageId } : {}),
      turnId,
      status,
      startedAt,
      ...(endedAt !== undefined ? { endedAt, durationMs: Math.max(0, endedAt - startedAt) } : {}),
      eventCount: events.length,
      toolCount: events.filter((event) => event.type === 'tool_call' || event.type === 'mcp_tool_call').length,
      tokenCount: events.filter((event) => event.type === 'usage').reduce((total, event) => total + usageTotal(event.data), 0),
      problemCount: events.filter((event) => problemTypes.has(event.type)).length,
    };
  }).sort((left, right) => right.startedAt - left.startedAt);
}

export function deriveWorkbenchArtifacts(snapshot: AgentTraceSnapshot | null): WorkbenchArtifact[] {
  if (!snapshot) return [];
  const outcomes = new Map<string, AgentTraceEvent>();
  for (const event of snapshot.events) {
    if (!toolTerminalTypes.has(event.type)) continue;
    const toolUseId = stringValue(event.data.toolUseId);
    if (toolUseId) outcomes.set(toolCorrelationKey(event, toolUseId), event);
  }
  return snapshot.events.flatMap((event): WorkbenchArtifact[] => {
    if (event.type !== 'tool_call') return [];
    const toolName = stringValue(event.data.toolName);
    const toolUseId = stringValue(event.data.toolUseId) || `tool-${event.sequence}`;
    const args = recordValue(event.data.args);
    const artifactId = toolCorrelationKey(event, toolUseId);
    const outcome = outcomes.get(artifactId);
    const status = artifactStatus(outcome);
    const durationMs = numberValue(outcome?.data.durationMs);
    const common = {
      id: artifactId,
      ...(event.runtimeId ? { runtimeId: event.runtimeId } : {}),
      turnId: event.turnId,
      status,
      ...(durationMs !== undefined ? { durationMs } : {}),
      recordedAt: event.recordedAt,
    } as const;
    if (toolName === 'write_file' || toolName === 'edit_file') {
      const filePath = stringValue(args.file_path ?? args.path) || 'unknown file';
      return [{
        ...common,
        kind: 'file-change',
        title: toolName === 'write_file' ? '写入文件' : '编辑文件',
        path: filePath,
        detail: artifactOutputDetail(outcome),
        diff: fileDiff(toolName, args, filePath),
      }];
    }
    if (toolName === 'bash') {
      const command = stringValue(args.command);
      if (!command) return [];
      return [{
        ...common,
        kind: isTestCommand(command) ? 'test' : 'command',
        title: command.slice(0, 160),
        detail: artifactOutputDetail(outcome),
      }];
    }
    return [];
  }).sort((left, right) => right.recordedAt - left.recordedAt);
}

export function deriveAgentRunSteps(snapshot: AgentTraceSnapshot | null, run: AgentRunIdentity | undefined): AgentRunStep[] {
  if (!snapshot || !run) return [];
  const { turnId } = run;
  const events = snapshot.events.filter((event) => matchesRun(event, run));
  const outcomes = new Map<string, AgentTraceEvent>();
  for (const event of events) {
    if (!toolTerminalTypes.has(event.type)) continue;
    const toolUseId = stringValue(event.data.toolUseId);
    if (toolUseId) outcomes.set(toolCorrelationKey(event, toolUseId), event);
  }

  const steps = events.flatMap((event): AgentRunStep[] => {
    const common = { id: `${event.runtimeId ?? 'legacy'}:${turnId}:${event.sequence}`, recordedAt: event.recordedAt } as const;
    if (event.type === 'turn_start') {
      return [{ ...common, title: '接收任务', detail: shortTurn(turnId), status: 'completed' }];
    }
    if (event.type === 'capability_resolution') {
      return [{
        ...common,
        title: '准备运行能力',
        detail: `${arrayLength(event.data.tools)} tools · ${arrayLength(event.data.skills)} skills`,
        status: 'completed',
      }];
    }
    if (event.type === 'iteration_start') {
      return [{
        ...common,
        title: `推理迭代 ${String(event.data.iteration ?? '')}`.trim(),
        detail: event.data.maxIterations == null ? undefined : `上限 ${String(event.data.maxIterations)}`,
        status: 'completed',
      }];
    }
    if (event.type === 'tool_call') {
      const toolUseId = stringValue(event.data.toolUseId) || `tool-${event.sequence}`;
      const outcome = outcomes.get(toolCorrelationKey(event, toolUseId));
      const args = recordValue(event.data.args);
      const toolName = stringValue(event.data.toolName) || 'tool';
      const detail = toolStepDetail(toolName, args, toolUseId);
      const durationMs = numberValue(outcome?.data.durationMs);
      return [{
        ...common,
        id: toolCorrelationKey(event, toolUseId),
        title: `运行 ${toolName}`,
        ...(detail ? { detail } : {}),
        status: artifactStatus(outcome),
        ...(durationMs !== undefined ? { durationMs } : {}),
      }];
    }
    if (event.type === 'subagent_start') {
      return [{
        ...common,
        title: `委派 ${stringValue(event.data.agentName) || '子 Agent'}`,
        detail: preview(event.data.description) || undefined,
        status: 'running',
      }];
    }
    if (event.type === 'subagent_end') {
      const failed = event.data.status === 'error';
      return [{
        ...common,
        title: failed ? '子 Agent 失败' : '子 Agent 返回',
        detail: preview(event.data.summary ?? event.data.error) || undefined,
        status: failed ? 'failed' : 'completed',
      }];
    }
    if (event.type === 'turn_end') return [{ ...common, title: '任务完成', detail: 'Agent 已返回结果', status: 'completed' }];
    if (event.type === 'turn_cancelled') return [{ ...common, title: '任务已停止', detail: preview(event.data.reason) || undefined, status: 'cancelled' }];
    if (event.type === 'budget_exceeded') return [{ ...common, title: '达到预算上限', detail: preview(event.data.budget) || undefined, status: 'failed' }];
    if (event.type === 'error') return [{ ...common, title: '任务失败', detail: preview(event.data.error) || undefined, status: 'failed' }];
    return [];
  });

  const task = deriveTaskRuns(snapshot).find((candidate) => candidate.id === runIdentityKey(run));
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (step.status !== 'running') continue;
    if (task?.status === 'cancelled') steps[index] = { ...step, status: 'cancelled' };
    else if (task?.status === 'failed') steps[index] = { ...step, status: 'failed' };
    else if (task?.status === 'completed' || index < steps.length - 1) steps[index] = { ...step, status: 'completed' };
  }
  if (task?.status === 'running' && steps.length > 0 && steps.at(-1)?.status !== 'running') {
    steps.push({
      id: `${task.id}:waiting`,
      title: '等待 Agent 返回',
      detail: '任务仍在运行',
      status: 'running',
      recordedAt: events.at(-1)?.recordedAt ?? task.startedAt,
    });
  }
  return steps;
}

export function buildAgentRunReport(snapshot: AgentTraceSnapshot | null, context: AgentRunReportContext = {}): string {
  const runs = deriveTaskRuns(snapshot);
  const run = context.run ? runs.find((candidate) => candidate.id === runIdentityKey(context.run)) : runs[0];
  const identity = run ?? context.run;
  const turnId = identity?.turnId;
  const steps = deriveAgentRunSteps(snapshot, identity);
  const artifacts = deriveWorkbenchArtifacts(snapshot).filter((artifact) => identity && matchesRun(artifact, identity));
  const status = run ? taskStatusText(run.status) : '无运行记录';
  const lines = [
    '# Agent 运行报告',
    '',
    `- **会话：** ${markdownInline(context.sessionName || snapshot?.sessionKey || '未命名会话')}`,
    `- **任务 ID：** ${markdownInline(turnId || '—')}`,
    `- **状态：** ${status}`,
    `- **开始时间：** ${run ? new Date(run.startedAt).toISOString() : '—'}`,
    `- **耗时：** ${run?.durationMs === undefined ? (run?.status === 'running' ? '进行中' : '—') : `${run.durationMs.toLocaleString()} ms`}`,
    `- **工作目录：** ${markdownInline(context.workingDirectory || 'Host project root')}`,
    `- **安全策略：** ${markdownInline(context.safetyMode || '—')} / ${markdownInline(context.approvalMode || '—')} / network ${context.networkAccess ? 'enabled' : 'disabled'}`,
    `- **用量：** ${run?.toolCount ?? 0} tools / ${(run?.tokenCount ?? 0).toLocaleString()} tokens / ${run?.problemCount ?? 0} problems`,
  ];

  if (context.taskPrompt?.trim()) {
    lines.push('', '## 任务', '', ...markdownBlock('text', context.taskPrompt.trim()));
  }
  lines.push('', '## 执行轨迹', '');
  if (steps.length === 0) lines.push('- 暂无可用轨迹');
  else for (const step of steps) {
    lines.push(`- ${stepStatusMark(step.status)} **${reportStepTitle(step.title)}**${step.detail ? ` — ${markdownInline(step.detail)}` : ''}${step.durationMs === undefined ? '' : ` (${step.durationMs.toLocaleString()} ms)`}`);
  }

  lines.push('', '## 变更与产物', '');
  if (artifacts.length === 0) lines.push('- 本次运行没有文件、命令或测试产物。');
  else artifacts.forEach((artifact, index) => {
    lines.push(`### ${index + 1}. ${markdownInline(artifact.title)}`, '');
    lines.push(`- 类型：${artifact.kind}`, `- 状态：${artifact.status}`);
    if (artifact.path) lines.push(`- 路径：${markdownInlineCode(artifact.path)}`);
    if (artifact.durationMs !== undefined) lines.push(`- 耗时：${artifact.durationMs.toLocaleString()} ms`);
    if (artifact.diff) lines.push('', ...markdownBlock('diff', artifact.diff));
    else if (artifact.detail) lines.push('', ...markdownBlock('text', artifact.detail));
    lines.push('');
  });

  lines.push('---', `由 Zhin Agent 试验台于 ${new Date().toISOString()} 导出。`);
  return `${lines.join('\n').trim()}\n`;
}

export function presentTraceEvent(event: AgentTraceEvent): { readonly title: string; readonly detail: string; readonly tone: string } {
  const data = event.data;
  const tool = String(data.toolName ?? 'tool');
  switch (event.type) {
    case 'turn_start': return { title: '开始处理', detail: shortTurn(event.turnId), tone: 'running' };
    case 'capability_resolution': return { title: '能力已解析', detail: `${arrayLength(data.tools)} tools · ${arrayLength(data.skills)} skills`, tone: 'capability' };
    case 'iteration_start': return { title: `推理迭代 ${String(data.iteration ?? '')}`, detail: `上限 ${String(data.maxIterations ?? '—')}`, tone: 'thinking' };
    case 'thinking': return { title: '模型思考', detail: preview(data.text), tone: 'thinking' };
    case 'tool_call': return { title: `调用 ${tool}`, detail: preview(data.toolUseId), tone: 'tool' };
    case 'tool_result': return { title: `${tool} 完成`, detail: duration(data.durationMs), tone: 'success' };
    case 'tool_denied': return { title: `${tool} 被拒绝`, detail: preview(data.reason ?? data.policy), tone: 'problem' };
    case 'tool_failed': return { title: `${tool} 失败`, detail: preview(data.error), tone: 'problem' };
    case 'mcp_connect': return { title: `${String(data.serverName ?? 'MCP')} 连接`, detail: String(data.status ?? ''), tone: 'capability' };
    case 'mcp_tool_call': return { title: String(data.toolName ?? 'MCP tool'), detail: `via ${String(data.serverName ?? 'MCP')}`, tone: 'tool' };
    case 'subagent_start': return { title: `委派 ${String(data.agentName ?? 'subagent')}`, detail: preview(data.description), tone: 'capability' };
    case 'subagent_progress': return { title: '子 Agent 更新', detail: preview(data.summary), tone: 'running' };
    case 'subagent_end': return { title: '子 Agent 返回', detail: String(data.status ?? 'done'), tone: data.status === 'error' ? 'problem' : 'success' };
    case 'usage': return { title: `${usageTotal(data).toLocaleString()} tokens`, detail: usageDetail(data), tone: 'usage' };
    case 'turn_end': return { title: '本轮完成', detail: 'Agent 已返回结果', tone: 'success' };
    case 'turn_cancelled': return { title: '本轮取消', detail: preview(data.reason), tone: 'muted' };
    case 'budget_exceeded': return { title: '达到预算上限', detail: preview(data.budget), tone: 'problem' };
    case 'error': return { title: '执行失败', detail: preview(data.error), tone: 'problem' };
    default: return { title: event.type.replaceAll('_', ' '), detail: '', tone: 'muted' };
  }
}

export async function fetchAgentTrace(sessionKey: string, afterSequence = 0): Promise<AgentTraceSnapshot> {
  const base = getSandboxApiBase() || window.location.origin;
  const url = new URL('/api/agent/traces', `${base}/`);
  url.searchParams.set('sessionKey', sessionKey);
  url.searchParams.set('limit', '300');
  if (afterSequence > 0) url.searchParams.set('after', String(afterSequence));
  const response = await fetch(url, { headers: getSandboxAuthHeaders() });
  const body = await response.json().catch(() => ({})) as { success?: boolean; data?: AgentTraceSnapshot; error?: string };
  if (!response.ok || body.success === false || !body.data) {
    throw new Error(response.status === 503
      ? 'Agent Trace 尚未启用'
      : body.error || '无法读取 Agent Trace');
  }
  return body.data;
}

export async function cancelAgentTask(sessionKey: string): Promise<boolean> {
  const base = getSandboxApiBase() || window.location.origin;
  const response = await fetch(new URL('/api/agent/tasks/cancel', `${base}/`), {
    method: 'POST',
    headers: { ...getSandboxAuthHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ sessionKey }),
  });
  const body = await response.json().catch(() => ({})) as {
    success?: boolean;
    data?: { cancelled?: boolean };
    error?: string;
  };
  if (!response.ok || body.success === false) {
    throw new Error(body.error || '无法停止 Agent 任务');
  }
  return body.data?.cancelled === true;
}

function usageRecord(data: Record<string, unknown>): Record<string, unknown> {
  return data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {};
}

function usageTotal(data: Record<string, unknown>): number {
  return Number(usageRecord(data).totalTokens ?? 0);
}

function usageDetail(data: Record<string, unknown>): string {
  const usage = usageRecord(data);
  return `输入 ${Number(usage.promptTokens ?? 0).toLocaleString()} · 输出 ${Number(usage.completionTokens ?? 0).toLocaleString()}`;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function preview(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, 96);
  try { return JSON.stringify(value).slice(0, 96); } catch { return String(value).slice(0, 96); }
}

function duration(value: unknown): string {
  const ms = Number(value);
  return Number.isFinite(ms) ? `${ms.toLocaleString()} ms` : '执行完成';
}

function shortTurn(value: string): string {
  return value.length > 12 ? value.slice(0, 10) : value;
}

function artifactStatus(event: AgentTraceEvent | undefined): WorkbenchArtifact['status'] {
  if (!event) return 'running';
  if (event.type === 'tool_result') return 'completed';
  if (event.type === 'tool_denied') return 'denied';
  if (event.type === 'tool_cancelled') return 'cancelled';
  return 'failed';
}

function artifactOutputDetail(event: AgentTraceEvent | undefined): string | undefined {
  if (!event) return undefined;
  const value = event.data.output ?? event.data.error ?? event.data.reason;
  if (typeof value === 'string') return value.slice(0, 8_000) || undefined;
  if (value == null) return undefined;
  try { return JSON.stringify(value, null, 2).slice(0, 8_000); } catch { return String(value).slice(0, 8_000); }
}

function toolStepDetail(toolName: string, args: Record<string, unknown>, fallback: string): string {
  if (toolName === 'bash') return stringValue(args.command).slice(0, 160) || fallback;
  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'read_file') {
    return stringValue(args.file_path ?? args.path).slice(0, 160) || fallback;
  }
  return fallback;
}

function taskStatusText(status: AgentTaskStatus): string {
  if (status === 'running') return '运行中';
  if (status === 'completed') return '已完成';
  if (status === 'cancelled') return '已取消';
  return '失败';
}

function stepStatusMark(status: AgentRunStepStatus): string {
  if (status === 'completed') return '✓';
  if (status === 'running') return '◉';
  if (status === 'cancelled') return '■';
  return '×';
}

function markdownInline(value: string): string {
  return value.replace(/[\\`*_[\]<>]/gu, '\\$&').replace(/\r?\n/gu, ' ');
}

function reportStepTitle(value: string): string {
  const tool = /^运行 (.+)$/u.exec(value)?.[1];
  return tool ? `运行 ${markdownInlineCode(tool)}` : markdownInline(value);
}

function markdownInlineCode(value: string): string {
  const normalized = value.replace(/\r?\n/gu, ' ');
  const longestTicks = Math.max(0, ...[...normalized.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(1, longestTicks + 1));
  const padding = /^\s|\s$|^`|`$/u.test(normalized) ? ' ' : '';
  return `${fence}${padding}${normalized}${padding}${fence}`;
}

function markdownBlock(language: string, value: string): string[] {
  const longestTicks = Math.max(0, ...[...value.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longestTicks + 1));
  return [`${fence}${language}`, value, fence];
}

function fileDiff(toolName: string, args: Record<string, unknown>, filePath: string): string | undefined {
  if (toolName !== 'edit_file') return undefined;
  const diffPath = filePath.replace(/^\/+/, '');
  const before = stringValue(args.old_string);
  const after = stringValue(args.new_string);
  if (!before && !after) return undefined;
  return [
    `--- a/${diffPath}`,
    `+++ b/${diffPath}`,
    '@@',
    ...before.split('\n').map((line) => `- ${line}`),
    ...after.split('\n').map((line) => `+ ${line}`),
  ].join('\n').slice(0, 8_000);
}

function isTestCommand(command: string): boolean {
  return /(?:^|\s)(?:test|vitest|jest|pytest|cargo\s+test|go\s+test|pnpm\s+(?:run\s+)?test|npm\s+(?:run\s+)?test|yarn\s+test)(?:\s|$)/iu.test(command);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toolCorrelationKey(event: AgentTraceEvent, toolUseId: string): string {
  return `${event.runtimeId ?? 'legacy'}:${event.turnId}:${toolUseId}`;
}

function runCorrelationKey(event: AgentTraceEvent): string {
  return runIdentityKey(event);
}

function runIdentityKey(run: AgentRunIdentity): string {
  return `${run.runtimeId ?? 'legacy'}:${run.turnId}`;
}

function matchesRun(value: AgentRunIdentity, run: AgentRunIdentity): boolean {
  return value.turnId === run.turnId && value.runtimeId === run.runtimeId;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseCachedTraceEvent(value: unknown): AgentTraceEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (
    typeof item.sequence !== 'number'
    || typeof item.recordedAt !== 'number'
    || typeof item.sessionKey !== 'string'
    || typeof item.turnId !== 'string'
    || typeof item.type !== 'string'
    || !item.data
    || typeof item.data !== 'object'
    || Array.isArray(item.data)
  ) return undefined;
  return {
    ...(typeof item.runtimeId === 'string' ? { runtimeId: item.runtimeId } : {}),
    sequence: item.sequence,
    recordedAt: item.recordedAt,
    sessionKey: item.sessionKey,
    turnId: item.turnId,
    type: item.type,
    data: item.data as Record<string, unknown>,
  };
}

function nonNegativeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function browserTraceStorage(): AgentTraceStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}
