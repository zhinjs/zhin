/**
 * TurnTrace — one readable, redacted record of what happened in a single
 * Agent turn: who asked, every model call and its tokens, every tool call
 * with an argument summary, duration and result size, approval denials,
 * budget extensions, nested sub-agent turns and how the turn ended.
 *
 * The collector only folds TurnEvents (plus a few trace notes), so it never
 * influences execution. Persisted JSON uses snake_case keys.
 */
import type { TurnEvent } from '../event/turn-event.js';
import { redactTraceValue } from '../plugin-runtime/agent-trace-runtime.js';
import type { ContextBudgetReport } from './context-budget.js';
import { scrubSecrets } from './trace-redaction.js';
export { scrubSecrets } from './trace-redaction.js';
import type { ToolInvocationOrigin } from '@zhin.js/tool';
import { captureRequestBody, DEFAULT_TRACE_MAX_BYTES, RequestBodyTooLargeError, type TurnTraceRequest, type TurnTraceRequestStart } from './request-trace.js';

export const TURN_TRACE_VERSION = 1;

const MAX_TOOL_CALLS = 200;
const MAX_TIMELINE_ENTRIES = 300;
const MAX_SUBAGENTS = 20;
const ARGS_SUMMARY_LENGTH = 200;
const TEXT_SUMMARY_LENGTH = 300;

export type TurnTraceStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'budget_exceeded' | 'unknown';
export type TurnTraceToolStatus = 'running' | 'ok' | 'failed' | 'denied' | 'cancelled';

export interface TurnTracePrincipal {
  readonly subject_id: string;
  readonly display_name?: string;
  readonly roles: readonly string[];
  /** Initiator trust level (#726); every tool call in this trace ran under it. */
  readonly trust_level?: string;
}

export interface TurnTraceModelCall {
  readonly request_id?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly duration_ms?: number;
  readonly stop_reason?: string;
  readonly cache_write_tokens?: number;
  readonly reported?: import('@zhin.js/ai').TokenUsage['reported'];
  readonly index: number;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
  /** Prompt tokens served from the provider cache (#730). */
  readonly cache_read_tokens?: number;
  /** Completion tokens spent on reasoning (e.g. Gemini thoughtsTokenCount). */
  readonly reasoning_tokens?: number;
}

export interface TurnTraceToolCall {
  readonly tool_use_id: string;
  readonly tool_name: string;
  readonly args_summary: string;
  readonly status: TurnTraceToolStatus;
  /** Milliseconds since the turn started. */
  readonly started_at_ms: number;
  readonly duration_ms?: number;
  /** Size of the tool output in characters (output itself is never stored). */
  readonly result_size?: number;
  readonly error?: string;
  /** Policy that denied the call, for `denied`. */
  readonly policy?: string;
}

export interface TurnTraceBudgetExtension {
  readonly from: number;
  readonly to: number;
  readonly at_ms: number;
}

export interface TurnTraceSubagentTask {
  readonly task_id: string;
  readonly agent_name?: string;
  readonly description: string;
  readonly status: 'running' | 'ok' | 'error';
  readonly result_summary?: string;
}

export interface TurnTraceTimelineEntry {
  readonly at_ms: number;
  readonly kind: string;
  readonly detail: string;
}

export interface TurnTraceTermination {
  readonly status: TurnTraceStatus;
  readonly code?: string;
  readonly reason?: string;
}

export interface TurnTrace {
  readonly version: typeof TURN_TRACE_VERSION;
  readonly turn_id: string;
  readonly session_key: string;
  readonly principal?: TurnTracePrincipal;
  readonly origin?: ToolInvocationOrigin;
  readonly requests?: readonly TurnTraceRequest[];
  /** Epoch milliseconds. */
  readonly started_at: number;
  readonly ended_at?: number;
  readonly duration_ms?: number;
  readonly model_calls: readonly TurnTraceModelCall[];
  readonly usage: Readonly<{ prompt_tokens: number; completion_tokens: number; total_tokens: number }>;
  /** Estimated prompt cost by segment for the turn's first model request (#729). */
  readonly context_budget?: ContextBudgetReport;
  readonly tool_calls: readonly TurnTraceToolCall[];
  readonly budget: Readonly<{ extensions: readonly TurnTraceBudgetExtension[]; continuations: number }>;
  readonly subagent_tasks: readonly TurnTraceSubagentTask[];
  /** Nested sub-agent turns (`<parent>:subagent:<n>`). */
  readonly subagents: readonly TurnTrace[];
  readonly timeline: readonly TurnTraceTimelineEntry[];
  readonly termination: TurnTraceTermination;
  /** Entries dropped because a bounded list was full. */
  readonly dropped: number;
}

/** Facts that are not TurnEvents but belong in the trace. */
export type TurnTraceNote =
  | Readonly<{ kind: 'model_request'; request: TurnTraceRequestStart }>
  | Readonly<{ kind: 'model_request_end'; request_id: string; status: 'completed' | 'failed' | 'cancelled'; duration_ms: number; stop_reason?: string }>
  | Readonly<{ kind: 'budget_extended'; from: number; to: number }>
  | Readonly<{ kind: 'continuation'; index: number }>
  /** ADR 0042 §7: the harness told the model it was going in circles / on its last step. */
  | Readonly<{ kind: 'spin_hint'; family: string; calls: number; reason: string }>
  | Readonly<{ kind: 'last_iteration_nudge'; iteration: number; limit: number }>
  | Readonly<{ kind: 'context_budget'; report: ContextBudgetReport }>
  /** How the turn was admitted behind other turns of its session (#725). */
  | Readonly<{ kind: 'admission'; queued_ms: number; merged_messages: number; superseded_previous: boolean }>;

export interface TurnTraceInit {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly origin?: ToolInvocationOrigin;
  readonly maxRequestBytes?: number;
  readonly principal?: Readonly<{
    subjectId: string;
    displayName?: string;
    roles: readonly string[];
    trustLevel?: string;
  }>;
}

interface MutableToolCall {
  tool_use_id: string;
  tool_name: string;
  args_summary: string;
  status: TurnTraceToolStatus;
  started_at_ms: number;
  duration_ms?: number;
  result_size?: number;
  error?: string;
  policy?: string;
}

/** Folds the events of one turn (and its sub-agent turns) into a TurnTrace. */
export class TurnTraceCollector {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly #principal?: TurnTracePrincipal;
  readonly #origin?: ToolInvocationOrigin;
  readonly #requests = new Map<string, TurnTraceRequest>();
  readonly #requestBytes = new Map<string, number>();
  #requestBudget: { used: number; max: number };
  readonly #now: () => number;
  readonly #startedAt: number;
  #endedAt: number | undefined;
  #termination: TurnTraceTermination = { status: 'running' };
  readonly #modelCalls: TurnTraceModelCall[] = [];
  readonly #toolCalls = new Map<string, MutableToolCall>();
  readonly #extensions: TurnTraceBudgetExtension[] = [];
  #continuations = 0;
  #contextBudget: ContextBudgetReport | undefined;
  readonly #subagentTasks = new Map<string, TurnTraceSubagentTask>();
  readonly #children = new Map<string, TurnTraceCollector>();
  readonly #timeline: TurnTraceTimelineEntry[] = [];
  #dropped = 0;

  constructor(init: TurnTraceInit, now: () => number = Date.now) {
    this.turnId = init.turnId;
    this.sessionKey = init.sessionKey;
    this.#now = now;
    this.#startedAt = now();
    this.#requestBudget = { used: 0, max: init.maxRequestBytes ?? DEFAULT_TRACE_MAX_BYTES };
    this.#origin = init.origin ? snapshotOrigin(init.origin) : undefined;
    if (init.principal) {
      this.#principal = Object.freeze({
        subject_id: init.principal.subjectId,
        ...(init.principal.displayName ? { display_name: init.principal.displayName } : {}),
        roles: Object.freeze([...init.principal.roles]),
        ...(init.principal.trustLevel ? { trust_level: init.principal.trustLevel } : {}),
      });
    }
  }

  get finished(): boolean {
    return this.#endedAt !== undefined;
  }

  /** Nested collector for a sub-agent turn; created on first use. */
  child(turnId: string, sessionKey = `${this.sessionKey}#subagent`): TurnTraceCollector {
    const existing = this.#children.get(turnId);
    if (existing) return existing;
    const created = new TurnTraceCollector({ turnId, sessionKey, principal: this.#principalInit() }, this.#now);
    if (this.#children.size >= MAX_SUBAGENTS) {
      this.#dropped += 1;
      created.#requestBudget = { used: 0, max: 0 };
      return created;
    }
    created.#requestBudget = this.#requestBudget;
    this.#children.set(turnId, created);
    this.#addTimeline('subagent_turn', turnId);
    return created;
  }

  /** Finds this collector or a nested one by turn id. */
  find(turnId: string): TurnTraceCollector | undefined {
    if (turnId === this.turnId) return this;
    for (const child of this.#children.values()) {
      const found = child.find(turnId);
      if (found) return found;
    }
    return undefined;
  }

  note(note: TurnTraceNote): void {
    const at = this.#elapsed();
    if (note.kind === 'model_request') {
      const { body, ...metadata } = note.request;
      const previous = this.#requests.get(metadata.request_id);
      let capture: Partial<TurnTraceRequest> = {};
      if (body && metadata.body_status === 'recorded') {
        try {
          const captured = captureRequestBody(body, undefined, this.#requestBudget.max - this.#requestBudget.used + (this.#requestBytes.get(metadata.request_id) ?? 0));
          capture = { body: captured.body, estimated_tokens: captured.estimated_tokens };
          this.#requestBudget.used += captured.bytes - (this.#requestBytes.get(metadata.request_id) ?? 0);
          this.#requestBytes.set(metadata.request_id, captured.bytes);
        } catch (error) {
          this.#requestBudget.used -= this.#requestBytes.get(metadata.request_id) ?? 0;
          this.#requestBytes.delete(metadata.request_id);
          capture = { body: undefined, body_status: error instanceof RequestBodyTooLargeError ? 'too_large' : 'capture_failed',
            estimated_tokens: error instanceof RequestBodyTooLargeError ? error.estimatedTokens : undefined };
        }
      } else if (metadata.body_status !== 'recorded' && previous?.body) {
        this.#requestBudget.used -= this.#requestBytes.get(metadata.request_id) ?? 0;
        this.#requestBytes.delete(metadata.request_id);
        capture = { body: undefined, estimated_tokens: undefined };
      }
      this.#requests.set(metadata.request_id, Object.freeze({ ...previous, ...metadata,
        index: previous?.index ?? this.#requests.size + 1, ...capture }));
      if (!previous) this.#addTimeline('model_request', `#${this.#requests.size} ${metadata.provider}/${metadata.model}`);
    } else if (note.kind === 'model_request_end') {
      const previous = this.#requests.get(note.request_id);
      if (previous) this.#requests.set(note.request_id, Object.freeze({ ...previous, status: note.status,
        duration_ms: note.duration_ms, ...(note.stop_reason === undefined ? {} : { stop_reason: note.stop_reason }) }));
    } else if (note.kind === 'budget_extended') {
      this.#extensions.push(Object.freeze({ from: note.from, to: note.to, at_ms: at }));
      this.#addTimeline('budget_extended', `${note.from} → ${note.to} steps`);
    } else if (note.kind === 'spin_hint') {
      this.#addTimeline('spin_hint', `${note.family} x${note.calls}: ${note.reason}`);
    } else if (note.kind === 'last_iteration_nudge') {
      this.#addTimeline('last_iteration_nudge', `${note.iteration}/${note.limit}`);
    } else if (note.kind === 'context_budget') {
      // Keep the first request's report: it is the fixed cost of the turn.
      if (this.#contextBudget) return;
      this.#contextBudget = note.report;
      this.#addTimeline('context_budget', `~${note.report.total_tokens} tokens (fixed ~${note.report.fixed_tokens})`);
    } else if (note.kind === 'continuation') {
      this.#continuations = Math.max(this.#continuations, note.index);
      this.#addTimeline('continuation', `#${note.index}`);
    } else {
      this.#addTimeline('admission', describeAdmission(note));
    }
  }

  record(event: TurnEvent): void {
    switch (event.type) {
      case 'turn_start':
      case 'chunk':
      case 'thinking':
        return;
      case 'iteration_start':
        this.#addTimeline('iteration', event.maxIterations === undefined
          ? `${event.iteration}` : `${event.iteration}/${event.maxIterations}`);
        return;
      case 'usage': {
        const call = Object.freeze({
          index: this.#modelCalls.length + 1,
          ...(event.requestId === undefined ? {} : { request_id: event.requestId }),
          ...(event.provider !== undefined ? { provider: event.provider } : {}),
          ...(event.model !== undefined ? { model: event.model } : {}),
          ...(event.durationMs !== undefined ? { duration_ms: event.durationMs } : {}),
          ...(event.stopReason !== undefined ? { stop_reason: event.stopReason } : {}),
          ...(event.usage.reported ? { reported: Object.freeze({ ...event.usage.reported }) } : {}),
          ...(event.usage.cacheWriteTokens !== undefined ? { cache_write_tokens: event.usage.cacheWriteTokens } : {}),
          prompt_tokens: event.usage.promptTokens,
          completion_tokens: event.usage.completionTokens,
          total_tokens: event.usage.totalTokens,
          ...(event.usage.cacheReadTokens !== undefined ? { cache_read_tokens: event.usage.cacheReadTokens } : {}),
          ...(event.usage.reasoningTokens !== undefined ? { reasoning_tokens: event.usage.reasoningTokens } : {}),
        });
        this.#modelCalls.push(call);
        this.#addTimeline('model_call', `#${call.index} in=${call.prompt_tokens} out=${call.completion_tokens}`);
        return;
      }
      case 'tool_call':
        this.#startTool(event.toolUseId, event.toolName, summarizeArgs(event.args));
        this.#addTimeline('tool_call', `${event.toolName} ${summarizeArgs(event.args)}`);
        return;
      case 'tool_result': {
        const tool = this.#tool(event.toolUseId, event.toolName);
        if (!tool) return;
        tool.status = 'ok';
        tool.duration_ms = Math.round(event.durationMs);
        tool.result_size = outputSize(event.output);
        this.#addTimeline('tool_result', `${event.toolName} ok ${tool.duration_ms}ms ${tool.result_size} chars`);
        return;
      }
      case 'tool_failed': {
        const tool = this.#tool(event.toolUseId, event.toolName);
        if (!tool) return;
        tool.status = 'failed';
        tool.duration_ms = Math.round(event.durationMs);
        tool.error = summarizeText(event.error);
        this.#addTimeline('tool_failed', `${event.toolName}: ${tool.error}`);
        return;
      }
      case 'tool_denied': {
        const tool = this.#tool(event.toolUseId, event.toolName);
        if (!tool) return;
        tool.status = 'denied';
        tool.policy = event.policy;
        tool.error = summarizeText(event.reason);
        this.#addTimeline('tool_denied', `${event.toolName} (${event.policy}): ${tool.error}`);
        return;
      }
      case 'tool_cancelled': {
        const tool = this.#tool(event.toolUseId, event.toolName);
        if (!tool) return;
        tool.status = 'cancelled';
        tool.duration_ms = Math.round(event.durationMs);
        tool.error = summarizeText(event.reason);
        this.#addTimeline('tool_cancelled', `${event.toolName}: ${tool.error}`);
        return;
      }
      case 'subagent_start':
        this.#subagentTasks.set(event.taskId, Object.freeze({
          task_id: event.taskId,
          ...(event.agentName ? { agent_name: event.agentName } : {}),
          description: summarizeText(event.description),
          status: 'running',
        }));
        this.#addTimeline('subagent_start', `${event.taskId} ${summarizeText(event.description, 80)}`);
        return;
      case 'subagent_progress':
        this.#addTimeline('subagent_progress', `${event.taskId} ${summarizeText(event.summary, 80)}`);
        return;
      case 'subagent_end': {
        const task = this.#subagentTasks.get(event.taskId);
        this.#subagentTasks.set(event.taskId, Object.freeze({
          task_id: event.taskId,
          ...(task?.agent_name ? { agent_name: task.agent_name } : {}),
          description: task?.description ?? '',
          status: event.status,
          ...(event.result ? { result_summary: summarizeText(event.result) } : {}),
        }));
        this.#addTimeline('subagent_end', `${event.taskId} ${event.status}`);
        return;
      }
      case 'turn_end':
        this.#finish({ status: 'completed' });
        return;
      case 'error':
        this.#finish({
          status: 'failed',
          ...(event.code ? { code: event.code } : {}),
          reason: summarizeText(event.error?.message ?? String(event.error)),
        });
        return;
      case 'turn_cancelled':
        this.#finish({ status: 'cancelled', code: event.code, reason: summarizeText(event.reason) });
        return;
      case 'budget_exceeded':
        this.#finish({ status: 'budget_exceeded', code: event.budget });
        return;
      default:
        this.#addTimeline(event.type, summarizeText(JSON.stringify(redactTraceValue(withoutType(event))), 120));
    }
  }

  /** Closes the trace when the turn ended without a terminal event. */
  finalize(fallback: TurnTraceTermination = { status: 'unknown' }): void {
    for (const child of this.#children.values()) child.finalize();
    if (this.finished) return;
    this.#finish(fallback);
  }

  snapshot(): TurnTrace {
    const usage = this.#modelCalls.reduce(
      (total, call) => ({
        prompt_tokens: total.prompt_tokens + call.prompt_tokens,
        completion_tokens: total.completion_tokens + call.completion_tokens,
        total_tokens: total.total_tokens + call.total_tokens,
      }),
      { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    );
    return Object.freeze({
      version: TURN_TRACE_VERSION,
      turn_id: this.turnId,
      session_key: this.sessionKey,
      ...(this.#principal ? { principal: this.#principal } : {}),
      ...(this.#origin ? { origin: this.#origin } : {}),
      ...(this.#requests.size ? { requests: Object.freeze([...this.#requests.values()]) } : {}),
      started_at: this.#startedAt,
      ...(this.#endedAt !== undefined
        ? { ended_at: this.#endedAt, duration_ms: this.#endedAt - this.#startedAt }
        : {}),
      model_calls: Object.freeze([...this.#modelCalls]),
      usage: Object.freeze(usage),
      ...(this.#contextBudget ? { context_budget: this.#contextBudget } : {}),
      tool_calls: Object.freeze([...this.#toolCalls.values()].map(tool => Object.freeze({ ...tool }))),
      budget: Object.freeze({
        extensions: Object.freeze([...this.#extensions]),
        continuations: this.#continuations,
      }),
      subagent_tasks: Object.freeze([...this.#subagentTasks.values()]),
      subagents: Object.freeze([...this.#children.values()].map(child => child.snapshot())),
      timeline: Object.freeze([...this.#timeline]),
      termination: Object.freeze({ ...this.#termination }),
      dropped: this.#dropped,
    });
  }

  #startTool(toolUseId: string, toolName: string, argsSummary: string): MutableToolCall | undefined {
    if (this.#toolCalls.size >= MAX_TOOL_CALLS && !this.#toolCalls.has(toolUseId)) {
      this.#dropped += 1;
      return undefined;
    }
    const existing = this.#toolCalls.get(toolUseId);
    if (existing) return existing;
    const created: MutableToolCall = {
      tool_use_id: toolUseId,
      tool_name: toolName,
      args_summary: argsSummary,
      status: 'running',
      started_at_ms: this.#elapsed(),
    };
    this.#toolCalls.set(toolUseId, created);
    return created;
  }

  /** Result/denial events may arrive without a prior tool_call (e.g. pre-call denial). */
  #tool(toolUseId: string, toolName: string): MutableToolCall | undefined {
    return this.#toolCalls.get(toolUseId) ?? this.#startTool(toolUseId, toolName, '');
  }

  #finish(termination: TurnTraceTermination): void {
    if (this.finished) return;
    this.#termination = Object.freeze(termination);
    this.#endedAt = this.#now();
    for (const tool of this.#toolCalls.values()) {
      if (tool.status === 'running') tool.status = 'cancelled';
    }
    for (const [id, request] of this.#requests) {
      if (request.status === 'running') this.#requests.set(id, Object.freeze({ ...request,
        status: termination.status === 'cancelled' ? 'cancelled' : 'unknown' }));
    }
    this.#addTimeline('end', [termination.status, termination.code, termination.reason].filter(Boolean).join(' '));
  }

  #addTimeline(kind: string, detail: string): void {
    if (this.#timeline.length >= MAX_TIMELINE_ENTRIES) {
      this.#dropped += 1;
      return;
    }
    this.#timeline.push(Object.freeze({ at_ms: this.#elapsed(), kind, detail }));
  }

  #elapsed(): number {
    return Math.max(0, this.#now() - this.#startedAt);
  }

  #principalInit(): TurnTraceInit['principal'] {
    if (!this.#principal) return undefined;
    return {
      subjectId: this.#principal.subject_id,
      ...(this.#principal.display_name ? { displayName: this.#principal.display_name } : {}),
      roles: this.#principal.roles,
      ...(this.#principal.trust_level ? { trustLevel: this.#principal.trust_level } : {}),
    };
  }
}

function snapshotOrigin(origin: ToolInvocationOrigin): ToolInvocationOrigin {
  if (origin.kind !== 'im') {
    switch (origin.kind) {
      case 'http': return Object.freeze({ kind: origin.kind, sessionId: origin.sessionId });
      case 'a2a': return Object.freeze({ kind: origin.kind, taskId: origin.taskId });
      case 'schedule': return Object.freeze({ kind: origin.kind, jobId: origin.jobId });
      case 'internal': return Object.freeze({ kind: origin.kind, source: origin.source });
      case 'mcp': return Object.freeze({ kind: origin.kind, requestId: origin.requestId });
    }
  }
  const conversation = origin.conversation;
  return Object.freeze({ kind: origin.kind, platform: origin.platform, endpoint: origin.endpoint,
    scope: origin.scope, sceneId: origin.sceneId,
    ...(origin.messageId === undefined ? {} : { messageId: origin.messageId }),
    ...(origin.threadId === undefined ? {} : { threadId: origin.threadId }),
    ...(conversation ? { conversation: Object.freeze({
      endpoint: Object.freeze({ adapter: conversation.endpoint.adapter, id: conversation.endpoint.id }),
      kind: conversation.kind, id: conversation.id,
      ...(conversation.parent ? { parent: Object.freeze({ kind: conversation.parent.kind, id: conversation.parent.id }) } : {}),
      ...(conversation.threadId === undefined ? {} : { threadId: conversation.threadId }),
    }) } : {}),
  });
}

/** Redacted, single-line, length-bounded summary of tool arguments. */
function describeAdmission(note: Extract<TurnTraceNote, { kind: 'admission' }>): string {
  const parts = [`queued ${Math.round(note.queued_ms)}ms`];
  if (note.merged_messages > 1) parts.push(`merged ${note.merged_messages} messages`);
  if (note.superseded_previous) parts.push('replaced the sender\'s unanswered turn');
  return parts.join(', ');
}

export function summarizeArgs(args: unknown): string {
  if (args == null) return '';
  const redacted = redactTraceValue(args);
  const text = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  return clip(scrubSecrets(text ?? ''), ARGS_SUMMARY_LENGTH);
}

function summarizeText(value: unknown, max = TEXT_SUMMARY_LENGTH): string {
  const redacted = redactTraceValue(value);
  const text = typeof redacted === 'string' ? redacted : JSON.stringify(redacted) ?? '';
  return clip(scrubSecrets(text.replace(/\s+/g, ' ').trim()), max);
}


function outputSize(output: unknown): number {
  if (output == null) return 0;
  if (typeof output === 'string') return output.length;
  try {
    return JSON.stringify(output)?.length ?? 0;
  } catch {
    return 0;
  }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function withoutType(event: TurnEvent): Record<string, unknown> {
  const { type: _type, ...rest } = event as unknown as Record<string, unknown>;
  return rest;
}
