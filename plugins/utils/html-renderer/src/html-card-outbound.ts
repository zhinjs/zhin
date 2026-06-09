/**
 * 通过 before.sendMessage 将 `html` 消息段转为 PNG 图片。
 */
import { segment, type SendOptions } from 'zhin.js';
import { formatCompact } from 'zhin.js';
import type { HtmlRendererConfig, HtmlRendererService } from './types.js';

export interface HtmlCardOutboundConfig {
  enabled?: boolean;
  onlyAdapters?: string[];
}

function isCardOutboundOn(raw: HtmlRendererConfig['cardOutbound']): boolean {
  if (raw === false) return false;
  if (raw == null) return true;
  if (typeof raw === 'object' && raw.enabled === false) return false;
  return true;
}

function asArray(content: SendOptions['content']): unknown[] {
  if (content == null) return [];
  return Array.isArray(content) ? content : [content];
}

export function registerHtmlCardOutbound(params: {
  root: {
    on: (ev: 'before.sendMessage', fn: (o: SendOptions) => unknown) => void;
    off?: (ev: 'before.sendMessage', fn: (o: SendOptions) => unknown) => void;
  };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  fullConfig: HtmlRendererConfig;
  getRenderer: () => HtmlRendererService;
}): (() => void) | undefined {
  const { root, logger, fullConfig, getRenderer } = params;
  if (!isCardOutboundOn(fullConfig.cardOutbound)) {
    logger.debug('html-renderer: cardOutbound 未启用');
    return;
  }

  const opts = typeof fullConfig.cardOutbound === 'object' ? fullConfig.cardOutbound : {};

  const handler = async (options: SendOptions) => {
    try {
      const { context, content } = options;
      if (content == null) return options;

      if (opts.onlyAdapters?.length && !opts.onlyAdapters.includes(context)) {
        return options;
      }

      const items = asArray(content);
      if (!items.some((item) => typeof item === 'object' && item != null && (item as { type?: string }).type === 'html')) {
        return options;
      }

      const renderer = getRenderer();
      const out: unknown[] = [];

      for (const item of items) {
        if (typeof item !== 'object' || item == null || (item as { type?: string }).type !== 'html') {
          out.push(item);
          continue;
        }
        const data = (item as { data?: Record<string, unknown> }).data ?? {};
        const html = typeof data.html === 'string' ? data.html : '';
        if (!html) continue;

        const result = await renderer.render(html, {
          width: typeof data.width === 'number' ? data.width : 540,
          format: 'png',
          backgroundColor: typeof data.backgroundColor === 'string' ? data.backgroundColor : '#d8dce3',
        });

        if (result.format !== 'png' || typeof result.data !== 'object') {
          out.push(item);
          continue;
        }

        const base64 = Buffer.from(result.data as Buffer).toString('base64');
        const fileName = typeof data.fileName === 'string' ? data.fileName : 'card.png';
        out.push(segment('image', { url: `base64://${base64}`, name: fileName }));
      }

      if (out.length === 0) return options;
      return { ...options, content: out.length === 1 ? out[0] as SendOptions['content'] : out as SendOptions['content'] };
    } catch (e) {
      logger.warn(formatCompact({
        op: 'html_card_outbound',
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      return options;
    }
  };

  root.on('before.sendMessage', handler);
  logger.info(formatCompact({ op: 'html_card_outbound' }));

  return () => root.off?.('before.sendMessage', handler);
}
