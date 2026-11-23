import { createMessages, type Locale } from '@zhin.js/plugin-runtime';
import { safeDisplayName } from '../security/high-risk-explain.js';

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
 * harness says so in a fixed label that names the server through `safeDisplayName` (the rule the card's
 * "Rule" and "Sources" lines use); the upstream text follows on the same line, folded to one line and cut at
 * `MAX_UPSTREAM_ACTION_CHARS`. Without an upstream description the line is the harness's own
 * "calling tool Y of MCP server X", both names escaped, so no upstream text appears at all.
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
    return actionMessages(locale, 'mcpCall', { server: safeDisplayName(server), tool: safeDisplayName(upstreamName) });
  }
  return actionMessages(locale, 'upstream', {
    server: safeDisplayName(server),
    text: truncate(first, MAX_UPSTREAM_ACTION_CHARS),
  });
}
