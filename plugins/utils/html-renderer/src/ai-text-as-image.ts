/**
 * 通过 before.sendMessage 将纯文本发送转为 PNG（可配置）。
 */
import type { SendContent, SendOptions } from 'zhin.js';
import { segment } from 'zhin.js';
import type { HtmlRendererAiTextAsImageConfig, HtmlRendererConfig, HtmlRendererService } from './types.js';

const RICH_STRING =
  /<\s*(image|video|audio|file|forward|xml|json|face|at)\b/i;

function isAiImageFeatureOn(raw: HtmlRendererConfig['aiTextAsImage']): boolean {
  if (raw === true) return true;
  if (raw == null || raw === false) return false;
  if (typeof raw === 'object' && raw.enabled === false) return false;
  return true;
}

function mergeAiConfig(
  base: HtmlRendererConfig,
  raw: HtmlRendererConfig['aiTextAsImage'],
): HtmlRendererAiTextAsImageConfig {
  const obj = raw === true || raw === false || raw == null ? {} : raw;
  return {
    onlyAdapters: obj.onlyAdapters,
    minLength: obj.minLength ?? 1,
    maxLength: obj.maxLength ?? 12_000,
    skipIfRich: obj.skipIfRich !== false,
    width: obj.width ?? base.defaultWidth ?? 720,
    height: obj.height,
    backgroundColor: obj.backgroundColor ?? base.defaultBackgroundColor ?? '#ffffff',
    fontSize: obj.fontSize ?? 16,
    color: obj.color ?? '#1a1a1a',
    padding: obj.padding ?? 20,
    scale: obj.scale ?? 2,
    fileName: obj.fileName ?? 'message.png',
  };
}

/**
 * 若内容为「仅纯文本」则返回合并后的字符串，否则返回 null（不转换）。
 */
export function extractPlainTextForImage(
  content: SendContent,
  skipIfRich: boolean,
): string | null {
  const parts = (Array.isArray(content) ? content : [content]) as (
    | string
    | { type?: unknown; data?: Record<string, unknown> }
  )[];

  if (parts.length === 0) return null;

  const texts: string[] = [];

  for (const p of parts) {
    if (typeof p === 'string') {
      if (skipIfRich && (RICH_STRING.test(p) || /\bCQ:/i.test(p))) return null;
      texts.push(p);
      continue;
    }
    if (p == null || typeof p !== 'object') return null;
    const t = p.type;
    if (typeof t !== 'string') return null;
    if (t !== 'text') return null;
    const raw = p.data?.text;
    if (raw != null && typeof raw !== 'string') return null;
    texts.push(raw ?? '');
  }

  return texts.join('');
}

function buildPlainTextHtml(text: string, opts: HtmlRendererAiTextAsImageConfig): string {
  const pad = opts.padding ?? 20;
  const escaped = segment.escape(text);
  return `<div style="display:flex;flex-direction:column;width:100%;box-sizing:border-box;padding:${pad}px;font-family:Noto Sans SC,sans-serif;font-size:${opts.fontSize}px;color:${opts.color};line-height:1.65;white-space:pre-wrap;word-break:break-word;">${escaped}</div>`;
}

export function registerAiTextAsImageOutput(params: {
  root: { on: (ev: 'before.sendMessage', fn: (o: SendOptions) => unknown) => void };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  fullConfig: HtmlRendererConfig;
  getRenderer: () => HtmlRendererService;
}): void {
  const { root, logger, fullConfig, getRenderer } = params;

  if (!isAiImageFeatureOn(fullConfig.aiTextAsImage)) {
    logger.debug('html-renderer: aiTextAsImage 未启用');
    return;
  }

  const aiOpts = mergeAiConfig(fullConfig, fullConfig.aiTextAsImage);

  root.on('before.sendMessage', async (options: SendOptions) => {
    try {
      const { context, content } = options;
      if (content == null) return options;

      if (aiOpts.onlyAdapters?.length && !aiOpts.onlyAdapters.includes(context)) {
        return options;
      }

      const plain = extractPlainTextForImage(content, aiOpts.skipIfRich !== false);
      if (plain == null) return options;

      const trimmed = plain.trim();
      if (trimmed.length < (aiOpts.minLength ?? 1)) return options;
      const maxLen = aiOpts.maxLength ?? 0;
      if (maxLen > 0 && plain.length > maxLen) {
        logger.debug(`html-renderer: 文本过长 (${plain.length}>${maxLen})，跳过转图`);
        return options;
      }

      const html = buildPlainTextHtml(plain, aiOpts);
      const renderer = getRenderer();
      const result = await renderer.render(html, {
        width: aiOpts.width,
        height: aiOpts.height,
        format: 'png',
        backgroundColor: aiOpts.backgroundColor,
        scale: aiOpts.scale,
      });

      if (result.format !== 'png' || typeof result.data !== 'object') return options;

      const base64 = Buffer.from(result.data as Buffer).toString('base64');
      const dataUrl = `data:${result.mimeType};base64,${base64}`;

      return {
        ...options,
        content: segment('image', { url: dataUrl, name: aiOpts.fileName }),
      };
    } catch (e) {
      logger.warn(
        'html-renderer: 纯文本转图失败，已回退为原文:',
        e instanceof Error ? e.message : e,
      );
      return options;
    }
  });

  logger.info('html-renderer: 已启用 aiTextAsImage（before.sendMessage 纯文本→PNG）');
}
