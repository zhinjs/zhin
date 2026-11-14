/**
 * Honest reporting of tool calls that did not run (#1250 `agent-claims-success-after-denied-tool`).
 *
 * A denied or failed tool call used to reach the model as the bare policy reason, and the model
 * sometimes answered "记住啦" although nothing was written. Two layers keep the reply honest:
 *
 * 1. The tool result itself starts with 「未执行」 / "NOT EXECUTED" and the reason, and tells the
 *    model to say so in its reply.
 * 2. When the turn ends with a side-effect tool that was denied or failed (and not later completed),
 *    and the final reply does not acknowledge it, the framework appends one plain line naming the
 *    operation. The check is deliberately one-sided: it never removes or rewrites model text, it only
 *    adds a line when the reply says nothing about the failure.
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

const ACKNOWLEDGEMENT = new RegExp([
  '未执行', '未能', '未成功', '未完成', '未生效', '未保存', '未写入', '未记录', '未创建',
  '没(?:有)?(?:能)?(?:执行|成功|完成|生效|保存|记住|记下|写入|写进|存下|创建|建成|做到|办成|改成|添加|设置|发出|发送|删除|处理)',
  '无法', '不能', '失败', '被拒', '拒绝', '审批', '没法', '做不到', '办不到',
  '(?:建|写|存|记|删|改|发)不了', '(?:写|存|记)不(?:进|住|下)', '不可用',
  "\\bnot\\b[^.!?\\n]{0,24}\\b(?:executed|done|completed|saved|applied|created|stored|remembered|run)\\b",
  "\\bfail(?:ed|ure)?\\b", "\\bcould(?:n['’]?t| not)\\b", "\\bunable\\b", "\\bdenied\\b", "\\brejected\\b",
  "\\bdid(?:n['’]?t| not)\\b", "\\bwas(?:n['’]?t| not)\\b", '\\bapproval\\b',
  "\\b(?:not|isn['’]?t|aren['’]?t)\\s+(?:available|allowed|possible|permitted)\\b", '\\bunavailable\\b',
  "\\bcan(?:not|['’]t)\\b", "\\bwon['’]?t\\b",
].join('|'), 'iu');

/** Whether the reply already tells the user that something was not done. */
export function acknowledgesUnexecuted(reply: string): boolean {
  return ACKNOWLEDGEMENT.test(reply);
}
