/**
 * web_fetch — HTTP(S) 抓取、SSRF 防护、HTML 去标签与长度截断
 */
import { type Tool, type Message, type ToolParametersSchema, type ToolResult, htmlToPlainText } from '@zhin.js/core';
import { errMsg } from '../discovery/utils.js';
import { runToolPolicies, toolPolicyResultToMessage } from '../security/policy-facade.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import { WEB_TOOL_FETCH_TIMEOUT_MS, ZHIN_WEB_USER_AGENT } from './web-tool-utils.js';
export const WEB_FETCH_DEFAULT_MAX_LENGTH = 20 * 1024;

export const WEB_FETCH_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'Full URL to fetch (http or https only)' },
    max_length: { type: 'number', description: 'Max characters to return (default 20480)' },
  },
  required: ['url'],
};

/** 与原先 builtin-tools 中 web_fetch 一致的正文提取（实现见 @zhin.js/core htmlToPlainText） */
export function stripFetchedHtmlToText(html: string): string {
  return htmlToPlainText(html);
}

/** SSRF 防护：检查主机名是否属于内网/私有/危险地址 */
export { isBlockedSsrfHostname } from '../security/network-policy.js';
import { isBlockedSsrfHostname } from '../security/network-policy.js';

export class WebFetchBuiltinTool extends BuiltinBaseTool {
  readonly name = 'web_fetch';
  readonly description =
    'Fetch a URL and extract readable page text (strips ads, scripts, etc.). http/https only.';
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
      // 统一安全策略门面（与原单层手写链等价）：dangerous-tool-approval
      const policyGate = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'web_fetch', commMessage }),
        'web_fetch',
      );
      if (policyGate) return policyGate;

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

      const MAX_REDIRECTS = 5;
      let currentUrl = String(args.url ?? '');
      let redirectCount = 0;
      let response: Response;

      // Manual redirect following with SSRF check at each hop
      while (true) {
        response = await fetch(currentUrl, {
          headers: { 'User-Agent': ZHIN_WEB_USER_AGENT },
          signal: AbortSignal.timeout(WEB_TOOL_FETCH_TIMEOUT_MS),
          redirect: 'manual',
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) break;

          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            return `Error: 超过最大重定向次数 (${MAX_REDIRECTS})`;
          }

          // Resolve relative redirects
          const redirectUrl = new URL(location, currentUrl);
          const redirectHostname = redirectUrl.hostname.toLowerCase();

          // SSRF check on each redirect target
          if (isBlockedSsrfHostname(redirectHostname)) {
            return `ZHIN_NEEDS_OWNER:\n重定向目标 ${redirectHostname} 被 SSRF 防护拦截。`;
          }

          // Only follow http/https redirects
          if (!['http:', 'https:'].includes(redirectUrl.protocol)) {
            return `Error: 不允许重定向到 ${redirectUrl.protocol} 协议`;
          }

          currentUrl = redirectUrl.href;
          continue;
        }

        break;
      }
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
