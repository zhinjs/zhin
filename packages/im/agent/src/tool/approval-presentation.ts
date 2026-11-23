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

/**
 * Upstream text on one line: line breaks, other control characters, format characters (bidi overrides,
 * zero-width) and every run of whitespace become one space, so the text can neither start a line of its own
 * (a fake "Rule:" / "Sources:" line) nor reorder what is shown around it.
 */
function oneLine(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, ' ').trim();
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
  const server = tool.mcpServer;
  if (server === undefined) return approvalActionLabel(tool.name, tool.description);
  const text = tool.mcpDescriptionFromUpstream === false ? '' : oneLine(tool.description ?? '');
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
