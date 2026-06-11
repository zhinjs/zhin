/**
 * web_fetch — HTTP(S) 抓取、SSRF 防护、HTML 去标签与长度截断
 */
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { htmlToPlainText } from '@zhin.js/core';
import { errMsg } from '../discovery/utils.js';
import { checkDangerousToolAccess, toDenyError, toOwnerSignal } from '../security/dangerous-tool-policy.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import { WEB_TOOL_FETCH_TIMEOUT_MS, ZHIN_WEB_USER_AGENT } from './web-tool-utils.js';

export const WEB_FETCH_DEFAULT_MAX_LENGTH = 20 * 1024;

export const WEB_FETCH_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', description: '要抓取的完整 URL（需 http 或 https）' },
    max_length: { type: 'number', description: '最大返回字符数（默认 20480）' },
  },
  required: ['url'],
};

/** 与原先 builtin-tools 中 web_fetch 一致的正文提取（实现见 @zhin.js/core htmlToPlainText） */
export function stripFetchedHtmlToText(html: string): string {
  return htmlToPlainText(html);
}

function isBlockedSsrfHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h.endsWith('.local') ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export class WebFetchBuiltinTool extends BuiltinBaseTool {
  readonly name = 'web_fetch';
  readonly description =
    '抓取指定 URL 的网页内容并提取正文（去除广告、脚本等），返回可读文本。仅支持 http/https 协议。';
  readonly parameters = WEB_FETCH_PARAMETERS;
  readonly kind = 'web';

  constructor() {
    super();
    this.tags.push('web', 'fetch');
    this.keywords.push(
      '抓取网页',
      '打开链接',
      '获取网页',
      '读网页',
      'fetch',
      'url',
      '链接内容',
      '网页内容',
    );
  }

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    try {
      const accessDecision = checkDangerousToolAccess('web_fetch', commMessage);
      if (!accessDecision.allowed) {
        if (accessDecision.needsOwnerApproval) {
          return toOwnerSignal(accessDecision);
        }
        return toDenyError(accessDecision);
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(String(args.url ?? ''));
      } catch {
        return `Error: 无效的 URL 格式`;
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return `Error: 仅支持 http/https 协议，拒绝 ${parsedUrl.protocol}`;
      }
      const hostname = parsedUrl.hostname.toLowerCase();
      if (isBlockedSsrfHostname(hostname)) {
        return `ZHIN_NEEDS_OWNER:\n禁止访问内网地址 ${hostname}（SSRF 防护）。若确有需要，请 Owner 确认风险后调整策略或在受控环境代为抓取。`;
      }

      const response = await fetch(String(args.url ?? ''), {
        headers: { 'User-Agent': ZHIN_WEB_USER_AGENT },
        signal: AbortSignal.timeout(WEB_TOOL_FETCH_TIMEOUT_MS),
        redirect: 'follow',
      });
      if (!response.ok) return `HTTP ${response.status}: ${response.statusText}`;
      const html = await response.text();
      const text = stripFetchedHtmlToText(html);
      const maxLen = typeof args.max_length === 'number' ? args.max_length : WEB_FETCH_DEFAULT_MAX_LENGTH;
      return text.length > maxLen ? text.slice(0, maxLen) + '\n...(truncated)' : text;
    } catch (e: unknown) {
      return `Error: ${errMsg(e)}`;
    }
  }
}

export function createWebFetchTool(): Tool {
  return new WebFetchBuiltinTool().toTool();
}
