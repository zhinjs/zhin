/**
 * Honest reporting of tool calls that did not run (#1250 `agent-claims-success-after-denied-tool`).
 *
 * A denied or failed tool call used to reach the model as the bare policy reason, and the model
 * sometimes answered "记住啦" although nothing was written. Two layers keep the reply honest:
 *
 * 1. The tool result itself starts with 「未执行」 / "NOT EXECUTED" and the reason, and tells the
 *    model to say so in its reply.
 * 2. When the turn ends with a side-effect tool that was denied or failed (and not later completed),
 *    the framework always adds one short deterministic line naming the kind of operation
 *    (「（提醒、记忆等操作未执行）」). It never removes or rewrites model text and does not try to guess
 *    from keywords whether the reply already admitted it (「记住啦，你不能吃香菜」 contains 不能 but
 *    admits nothing). A streamed reply gets the line as a short follow-up message instead.
 *
 * "Side-effect tool" = any tool not declared read-only (`readOnly` / `isReadOnly`), the same rule
 * restricted turns already use; undeclared tools count as writing.
 */
import type { ToolCallRecord } from './tool-calls-user-format.js';

/** Tools whose failure is internal plumbing, never an operation the user asked for. */
const INTERNAL_TOOLS: ReadonlySet<string> = new Set(['load_skill', 'discover', 'load_tool', 'prepare_reply']);

export type UnexecutedToolKind = 'denied' | 'failed';

/** Model-facing tool-result text for a call that did not run (or did not finish). */
export function formatUnexecutedToolResult(
  toolName: string,
  kind: UnexecutedToolKind,
  reason: string,
  sideEffect: boolean,
): string {
  const head = kind === 'denied'
    ? `未执行（NOT EXECUTED）：工具「${toolName}」被拒绝，没有运行。原因：${reason}`
    : `未执行成功（NOT COMPLETED）：工具「${toolName}」运行出错，操作没有完成。原因：${reason}`;
  if (!sideEffect) return head;
  return `${head}\n这一步的写入/变更没有生效。回复用户时必须如实说明它没有完成，不要说已经完成、已记住或已保存。`;
}

/**
 * Side-effect calls of this phase that were denied or failed and never completed afterwards
 * (a later successful retry of the same tool clears an earlier failure).
 */
export function unresolvedSideEffectFailures(calls: readonly ToolCallRecord[]): readonly ToolCallRecord[] {
  const pending = new Map<string, ToolCallRecord>();
  for (const call of calls) {
    if (INTERNAL_TOOLS.has(call.tool)) continue;
    if (call.status === 'completed') pending.delete(call.tool);
    else if ((call.status === 'denied' || call.status === 'failed') && call.sideEffect === true) pending.set(call.tool, call);
  }
  return [...pending.values()];
}

/** Action kinds named in the notice, so the user knows what was not done without seeing tool names. */
type UnexecutedActionKind = 'reminder' | 'memory' | 'config' | 'file' | 'command' | 'message';

const ACTION_KIND_PATTERNS: ReadonlyArray<readonly [UnexecutedActionKind, RegExp]> = [
  ['reminder', /schedule|cron|remind|timer|alarm/i],
  ['memory', /memory|remember/i],
  ['config', /config|setting|install|plugin/i],
  ['command', /^(?:bash|shell|exec)(?:_|$)/i],
  ['file', /file|dir/i],
  ['message', /send|message|post|notice|announce|reply|forward/i],
];

const ACTION_KIND_LABELS: Readonly<Record<UnexecutedActionKind, Readonly<Record<'zh-CN' | 'en', string>>>> = {
  reminder: { 'zh-CN': '提醒', en: 'reminders' },
  memory: { 'zh-CN': '记忆', en: 'memory' },
  config: { 'zh-CN': '配置', en: 'configuration' },
  command: { 'zh-CN': '命令', en: 'commands' },
  file: { 'zh-CN': '文件', en: 'files' },
  message: { 'zh-CN': '消息发送', en: 'messages' },
};

/**
 * The deterministic notice for unexecuted side-effect calls (#1250 owner review): always added when there
 * are any, whatever the reply says (no keyword guessing; an occasional redundant line is accepted).
 * Names action kinds (「提醒、记忆」), falling back to the tool name for a tool of no known kind.
 */
export function formatUnexecutedNotice(calls: readonly ToolCallRecord[], locale?: string): string {
  const lang = locale?.toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
  const labels: string[] = [];
  for (const call of calls) {
    const kind = ACTION_KIND_PATTERNS.find(([, pattern]) => pattern.test(call.tool))?.[0];
    const label = kind ? ACTION_KIND_LABELS[kind][lang] : lang === 'en' ? `"${call.tool}"` : `「${call.tool}」`;
    if (!labels.includes(label)) labels.push(label);
  }
  if (lang === 'en') return `(Not done: ${labels.join(', ')}.)`;
  return `（${labels.join('、')}${labels.length > 1 ? '等' : ''}操作未执行）`;
}
