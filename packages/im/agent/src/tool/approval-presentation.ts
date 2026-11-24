import { createMessages, type Locale } from '@zhin.js/plugin-runtime';
import { codeDisplayName } from '../security/high-risk-explain.js';

/** Keep internal qualified names out of the question when a tool describes its action. */
export function approvalActionLabel(toolName: string, description?: string): string {
  return description?.trim().split(/[\n。；;]/u)[0]?.trim()
    || toolName.split('__').at(-1) || toolName;
}

/** What the first line of an approval question needs to know about the tool. */
export interface ApprovalActionTool {
  readonly name: string;
  readonly description?: string;
  /** MCP connection identity (`ToolCapability.mcpServer`); set only on tools an MCP server provides. */
  readonly mcpServer?: string;
  /** `false` when the MCP server wrote no description and `description` is the harness fallback. */
  readonly mcpDescriptionFromUpstream?: boolean;
  /**
   * The legacy MCP bridge (`mcp-client/bridge.ts`) marks its tools with `mcpOrigin` instead of
   * `mcpServer`; read as a fallback so those tools are labelled too (#1250 b100 review).
   */
  readonly mcpOrigin?: { readonly server: string; readonly descriptionFromUpstream?: boolean };
}

/** #1250 b100: longest upstream description shown on the first line, in code points (before `…`). */
export const MAX_UPSTREAM_ACTION_CHARS = 200;

const actionMessages = createMessages({
  upstream: {
    'zh-CN': '上游描述（MCP 服务 {server} 提供，未经核实）：{text}',
    en: 'Upstream description (from MCP server {server}, unverified): {text}',
  },
  mcpCall: {
    'zh-CN': '调用 MCP 服务 {server} 的工具 {tool}',
    en: 'Calling tool {tool} of MCP server {server}',
  },
});

/** Line terminators a code span must not contain (most Markdown renderers end a code span at a line). */
const LITERAL_LINE_BREAKS = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/gu;
/** Word joiner: invisible, breaks `](` / `![` / `<tag` for renderers that do not support inline code. */
const WORD_JOINER = '\u2060';

/**
 * #1250 b102: text the harness did not write (upstream MCP descriptions, model-chosen arguments, commands,
 * paths, policy reasons quoting them) as one Markdown inline code span, so the approval card shows it
 * literally: no link, image, inline HTML, emphasis, heading or table syntax takes effect.
 *
 * Every platform renderer the adapters use (Console / Sandbox, Telegram, e-mail, the plain-text fallback
 * `markdownToPlainText`) knows single-backtick code spans on one line, but several do not know
 * CommonMark's longer backtick runs, so the span is always one backtick on each side: line breaks become
 * spaces and backticks inside the text become the full-width `｀` (U+FF40), so the text can neither close
 * the span early nor pair with the backticks of the "Rule" line. For renderers without inline code a
 * word joiner (invisible) also breaks `](`, `![` and `<` before a tag name. The plain-text fallback strips
 * the backticks, so no backslash or backtick shows there. Empty text stays empty.
 */
export function markdownLiteral(text: string): string {
  const literal = text.replace(LITERAL_LINE_BREAKS, ' ').replace(/`/gu, '\uff40')
    .replace(/\]\(/gu, `]${WORD_JOINER}(`).replace(/!\[/gu, `!${WORD_JOINER}[`)
    .replace(/<(?=[A-Za-z/!?])/gu, `<${WORD_JOINER}`);
  return literal ? `\`${literal}\`` : '';
}

/** `markdownLiteral` per line, for multi-line text (a shell command, a policy reason) that keeps its lines. */
export function markdownLiteralLines(text: string): string {
  return text.split(LITERAL_LINE_BREAKS).map(markdownLiteral).join('\n');
}

/** Every line terminator, including the ones `\n`-splitting misses (`\r`, `\v`, `\f`, NEL, LS, PS). */
const LINE_TERMINATORS = /\r\n|[\r\v\f\u0085\u2028\u2029]/gu;
/**
 * Folded to one space: other control and format characters (bidi overrides, zero-width, tag characters),
 * unassigned, private-use and lone surrogate code points, default-ignorable characters (Hangul fillers,
 * the combining grapheme joiner, variation selectors), the braille blank and every run of whitespace — so
 * upstream text can neither pad itself to a soft line break nor reorder what is shown around it.
 */
const FOLDED = /[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}\u2800\s]+/gu;
/** More than two combining marks in a row (stacked "Zalgo" text that draws over the lines around it). */
const STACKED_MARKS = /(\p{M}{2})\p{M}+/gu;

/**
 * Upstream text as the first line shows it: only its first line (as before b100, now for every line
 * terminator), then folded to one line, so it can never start a line of its own (a fake "Rule:" /
 * "Sources:" line), and stacked combining marks are cut to two.
 */
function oneLine(text: string): string {
  const first = text.replace(LINE_TERMINATORS, '\n').split('\n')[0] ?? '';
  return first.replace(FOLDED, ' ').replace(STACKED_MARKS, '$1').trim();
}

function truncate(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : `${points.slice(0, max).join('')}…`;
}

/**
 * #1250 b100: the first line of an approval question (the action). A first-party or plugin tool keeps
 * `approvalActionLabel`. For an MCP tool the description is written by the upstream server, so the
 * harness says so in a fixed label that names the server through `codeDisplayName` (the rule the card's
 * "Rule" and "Sources" lines use); the upstream text follows on the same line, folded to one line, cut at
 * `MAX_UPSTREAM_ACTION_CHARS` and shown literally (`markdownLiteral`, #1250 b102). Without an upstream
 * description the line is the harness's own "calling tool Y of MCP server X", both names escaped, so no
 * upstream text appears at all.
 */
export function describeApprovalAction(tool: ApprovalActionTool, locale?: Locale): string {
  const server = tool.mcpServer ?? tool.mcpOrigin?.server;
  if (server === undefined) return approvalActionLabel(tool.name, tool.description);
  const fromUpstream = tool.mcpServer !== undefined ? tool.mcpDescriptionFromUpstream : tool.mcpOrigin?.descriptionFromUpstream;
  const text = fromUpstream === false ? '' : oneLine(tool.description ?? '');
  const first = text.split(/[。；;]/u)[0]?.trim() ?? '';
  if (!first) {
    const prefix = `${server}__`;
    const upstreamName = tool.name.startsWith(prefix) && tool.name.length > prefix.length
      ? tool.name.slice(prefix.length) : tool.name;
    return actionMessages(locale, 'mcpCall', { server: codeDisplayName(server), tool: codeDisplayName(upstreamName) });
  }
  return actionMessages(locale, 'upstream', {
    server: codeDisplayName(server),
    // #1250 b102: shown literally (one inline code span), never as Markdown.
    text: markdownLiteral(truncate(first, MAX_UPSTREAM_ACTION_CHARS)),
  });
}
