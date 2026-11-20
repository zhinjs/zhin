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
import { createMessages, formatList, type Locale } from '@zhin.js/plugin-runtime';
import { inlineToolName, type ToolCallRecord } from './tool-calls-user-format.js';

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
  // #1250 b33: the name goes in inline code; a model echoing 「api60s__skill__weather」 lost its `__` to Markdown.
  const shown = inlineToolName(toolName);
  if (kind === 'reported') {
    const head = `执行失败（FAILED）：工具 ${shown} 报告了失败，是否已部分生效不确定。工具返回：${reason}`;
    if (!sideEffect) return head;
    return `${head}\n回复用户时如实说明这一步报告了失败，不要说已经完成；也不要断言没有任何改动，需要时请用户核实。`;
  }
  const head = kind === 'denied'
    ? `未执行（NOT EXECUTED）：工具 ${shown} 被拒绝，没有运行。原因：${reason}`
    : `未执行成功（NOT COMPLETED）：工具 ${shown} 运行出错，操作没有完成。原因：${reason}`;
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

/**
 * #1250 第 81 批: the user-facing notice and its kind labels, one bilingual catalog. The languages
 * join the parts differently (one bracket with `；` in zh-CN, one bracket per part in en), so the
 * sentence shapes `only` / `both` are entries too, not code branches.
 */
const noticeMessages = createMessages({
  reminder: { 'zh-CN': '提醒', en: 'reminders' },
  memory: { 'zh-CN': '记忆', en: 'memory' },
  config: { 'zh-CN': '配置', en: 'configuration' },
  command: { 'zh-CN': '命令', en: 'commands' },
  file: { 'zh-CN': '文件', en: 'files' },
  voice: { 'zh-CN': '语音', en: 'voice' },
  message: { 'zh-CN': '消息发送', en: 'messages' },
  /** No known kind among the calls. */
  kindsNone: { 'zh-CN': '部分', en: 'some actions' },
  /** Exactly the named kinds. */
  kindsExact: { 'zh-CN': '{labels}', en: '{labels}' },
  /** Several known kinds: zh-CN marks the list as open (「等」), en lists them as they are. */
  kindsSeveral: { 'zh-CN': '{labels}等', en: '{labels}' },
  /** Known kinds plus calls of no known kind. */
  kindsMore: { 'zh-CN': '{labels}等', en: '{labels} and other actions' },
  notRun: { 'zh-CN': '{kinds}操作未执行', en: '(Not done: {kinds}.)' },
  reported: { 'zh-CN': '{kinds}操作报告失败，是否已部分生效不确定', en: '(Reported as failed, may be partly done: {kinds}.)' },
  only: { 'zh-CN': '（{part}）', en: '{part}' },
  both: { 'zh-CN': '（{notRun}；{reported}）', en: '{notRun} {reported}' },
});

/**
 * The deterministic notice for unexecuted side-effect calls (#1250 owner review): always added when there
 * are any, whatever the reply says (no keyword guessing; an occasional redundant line is accepted).
 * Names action kinds (「提醒、记忆」); a tool of no known kind is never named (#1250 batch 26: tool names
 * such as `change_draft` or MCP tool ids are internal), it only adds 「等」 / 「部分」. Calls that reported
 * a failure in their result may have partly taken effect, so they get a weaker line than calls that never
 * ran or threw.
 */
export function formatUnexecutedNotice(calls: readonly ToolCallRecord[], locale?: Locale): string {
  const notRun = calls.filter((call) => call.reported !== true);
  const reported = calls.filter((call) => call.reported === true);
  const notRunPart = notRun.length ? noticeMessages(locale, 'notRun', { kinds: kindsText(notRun, locale) }) : '';
  const reportedPart = reported.length ? noticeMessages(locale, 'reported', { kinds: kindsText(reported, locale) }) : '';
  if (notRunPart && reportedPart) return noticeMessages(locale, 'both', { notRun: notRunPart, reported: reportedPart });
  const part = notRunPart || reportedPart;
  return part ? noticeMessages(locale, 'only', { part }) : '';
}

function kindsText(calls: readonly ToolCallRecord[], locale: Locale | undefined): string {
  const labels: string[] = [];
  let unknown = false;
  for (const call of calls) {
    const kind = ACTION_KIND_PATTERNS.find(([, pattern]) => pattern.test(call.tool))?.[0];
    if (!kind) {
      unknown = true;
      continue;
    }
    const label = noticeMessages(locale, kind);
    if (!labels.includes(label)) labels.push(label);
  }
  if (labels.length === 0) return noticeMessages(locale, 'kindsNone');
  const list = formatList(locale, labels);
  return noticeMessages(locale, unknown ? 'kindsMore' : labels.length > 1 ? 'kindsSeveral' : 'kindsExact', { labels: list });
}
