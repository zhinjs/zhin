/**
 * #1250 第 74 批：确认 / 取消词的唯一词表。
 *
 * 所有"回复确认 / 取消"的地方（交互提问、审批、Agent 停止、重启确认、功能自助确认、插件的多轮对话）
 * 都经这里判断，中英文不分语言都认：zh-CN 提问回 `yes`、en 提问回 `取消` 一样有效。
 *
 * 词分两档：
 * - **基础词**：在任何"等待确认 / 可取消"的场景都认，比如 `确认`、`ok`、`取消`、`退出`。
 * - **是非答语**（`yesNo: true`）：`是`、`好`、`不`、`否`、`no`、`n`、`拒绝` 等，只在明确的是非问答
 *   （confirm 提问、审批选项）里才算；普通对话里一句"不"或"no"不会被当成取消。
 *
 * 匹配先做 NFKC（全角转半角）、去首尾空白、去掉末尾标点（`！!。.？?` 等）、不区分大小写，
 * 然后整句比对：`我不确定`、`取消了吗` 都不是取消词。数字 `1` / `2` 只是选项题的序号，不在此表。
 */

/** 基础确认词：任何等待确认的地方都认。 */
const CONFIRM_WORDS: ReadonlySet<string> = new Set(['确认', '确定', '同意', 'confirm', 'yes', 'y', 'ok', 'agree']);
/** 只在是非问答里才算确认的词。 */
const YES_NO_CONFIRM_WORDS: ReadonlySet<string> = new Set(['是', '好', 'true']);
/** 基础取消词：任何可取消的地方都认（离开提问、停止正在执行的任务、退出多轮对话）。 */
const CANCEL_WORDS: ReadonlySet<string> = new Set(['取消', '退出', '算了', 'cancel', 'quit', 'exit']);
/** 只在是非问答里才算否定 / 取消的词。 */
const YES_NO_CANCEL_WORDS: ReadonlySet<string> = new Set(['不', '否', '拒绝', 'no', 'n', 'reject', 'false']);

/** 末尾可去掉的标点与空白（NFKC 之后，全角 `！？，` 已是半角）。 */
const TRAILING_PUNCTUATION = /[\s!.?~,;:。、…～]+$/u;

export interface ReplyWordOptions {
  /**
   * 是否处在明确的是非问答里（confirm 提问、审批选项）。为 `true` 时 `是` / `好` / `不` / `否` /
   * `no` / `n` / `拒绝` 等是非答语也算；默认只认基础词。
   */
  readonly yesNo?: boolean;
}

/** 规范化一条回复用于比对：NFKC、去首尾空白、去末尾标点、小写。 */
export function normalizeReplyWord(text: string): string {
  return text.normalize('NFKC').trim().replace(TRAILING_PUNCTUATION, '').trim().toLowerCase();
}

/** `text` 是否整句就是一个确认词（中英文均可，不分语言）。 */
export function isConfirmWord(text: string, options: ReplyWordOptions = {}): boolean {
  const word = normalizeReplyWord(text);
  return CONFIRM_WORDS.has(word) || (options.yesNo === true && YES_NO_CONFIRM_WORDS.has(word));
}

/** `text` 是否整句就是一个取消词（中英文均可，不分语言）。 */
export function isCancelWord(text: string, options: ReplyWordOptions = {}): boolean {
  const word = normalizeReplyWord(text);
  return CANCEL_WORDS.has(word) || (options.yesNo === true && YES_NO_CANCEL_WORDS.has(word));
}

/**
 * 是非答语里的"否"（`不` / `否` / `no` / `n` / `拒绝` …），不含基础取消词：选项题里一个带"否"别名的
 * 选项接受所有否定答语，而 `取消` / `退出` 仍是离开提问（内部使用，不进公共 API）。
 */
export function isNegativeAnswerWord(text: string): boolean {
  return YES_NO_CANCEL_WORDS.has(normalizeReplyWord(text));
}
