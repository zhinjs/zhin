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

/**
 * `denied`: never ran; `failed`: threw, so it did not finish; `reported`: ran and returned a failure in its
 * result (`{ error }`, MCP `isError`), so part of it may already have taken effect (#1250 batch 26).
 */
export type UnexecutedToolKind = 'denied' | 'failed' | 'reported';

/** Model-facing tool-result text for a call that did not run (or did not finish). */
export function formatUnexecutedToolResult(
  toolName: string,
  kind: UnexecutedToolKind,
  reason: string,
  sideEffect: boolean,
): string {
  if (kind === 'reported') {
    const head = `执行失败（FAILED）：工具「${toolName}」报告了失败，是否已部分生效不确定。工具返回：${reason}`;
    if (!sideEffect) return head;
    return `${head}\n回复用户时如实说明这一步报告了失败，不要说已经完成；也不要断言没有任何改动，需要时请用户核实。`;
  }
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
type UnexecutedActionKind = 'reminder' | 'memory' | 'config' | 'file' | 'command' | 'voice' | 'message';

const ACTION_KIND_PATTERNS: ReadonlyArray<readonly [UnexecutedActionKind, RegExp]> = [
  ['reminder', /schedule|cron|remind|timer|alarm/i],
  ['memory', /memory|remember/i],
  ['config', /config|setting|install|plugin|^change_|self_change/i],
  ['command', /^(?:bash|shell|exec)(?:_|$)/i],
  ['file', /file|dir/i],
  // #1250: speech tools report failure in their result (`voice_tts`); name the kind, not the tool.
  ['voice', /^voice_|tts|speech/i],
  ['message', /send|message|post|notice|announce|reply|forward/i],
];

const ACTION_KIND_LABELS: Readonly<Record<UnexecutedActionKind, Readonly<Record<'zh-CN' | 'en', string>>>> = {
  reminder: { 'zh-CN': '提醒', en: 'reminders' },
  memory: { 'zh-CN': '记忆', en: 'memory' },
  config: { 'zh-CN': '配置', en: 'configuration' },
  command: { 'zh-CN': '命令', en: 'commands' },
  file: { 'zh-CN': '文件', en: 'files' },
  voice: { 'zh-CN': '语音', en: 'voice' },
  message: { 'zh-CN': '消息发送', en: 'messages' },
};

/**
 * The deterministic notice for unexecuted side-effect calls (#1250 owner review): always added when there
 * are any, whatever the reply says (no keyword guessing; an occasional redundant line is accepted).
 * Names action kinds (「提醒、记忆」); a tool of no known kind is never named (#1250 batch 26: tool names
 * such as `change_draft` or MCP tool ids are internal), it only adds 「等」 / 「部分」. Calls that reported
 * a failure in their result may have partly taken effect, so they get a weaker line than calls that never
 * ran or threw.
 */
export function formatUnexecutedNotice(calls: readonly ToolCallRecord[], locale?: string): string {
  const lang = locale?.toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
  const notRun = calls.filter((call) => call.reported !== true);
  const reported = calls.filter((call) => call.reported === true);
  const parts: string[] = [];
  if (lang === 'en') {
    if (notRun.length) parts.push(`(Not done: ${englishKinds(notRun)}.)`);
    if (reported.length) parts.push(`(Reported as failed, may be partly done: ${englishKinds(reported)}.)`);
    return parts.join(' ');
  }
  if (notRun.length) parts.push(`${chineseKinds(notRun)}操作未执行`);
  if (reported.length) parts.push(`${chineseKinds(reported)}操作报告失败，是否已部分生效不确定`);
  return `（${parts.join('；')}）`;
}

function kindLabels(calls: readonly ToolCallRecord[], lang: 'zh-CN' | 'en'): { labels: string[]; unknown: boolean } {
  const labels: string[] = [];
  let unknown = false;
  for (const call of calls) {
    const kind = ACTION_KIND_PATTERNS.find(([, pattern]) => pattern.test(call.tool))?.[0];
    if (!kind) {
      unknown = true;
      continue;
    }
    const label = ACTION_KIND_LABELS[kind][lang];
    if (!labels.includes(label)) labels.push(label);
  }
  return { labels, unknown };
}

function chineseKinds(calls: readonly ToolCallRecord[]): string {
  const { labels, unknown } = kindLabels(calls, 'zh-CN');
  if (labels.length === 0) return '部分';
  return `${labels.join('、')}${labels.length > 1 || unknown ? '等' : ''}`;
}

function englishKinds(calls: readonly ToolCallRecord[]): string {
  const { labels, unknown } = kindLabels(calls, 'en');
  if (labels.length === 0) return 'some actions';
  return unknown ? `${labels.join(', ')} and other actions` : labels.join(', ');
}
