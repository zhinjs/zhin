import type { HtmlRendererForRichSegment } from './rich-segments/types.js';
import { importOptionalPeerPackage } from './optional-peer-import.js';

/** 动态 import 时使用的包名（与 @zhin.js/html-renderer package.json 一致） */
export const HTML_RENDERER_PACKAGE = '@zhin.js/html-renderer';

export interface LoadHtmlRendererOptions {
  getConfig?: () => Record<string, unknown> | undefined;
  warn?: (message: string) => void;
}

let cached: HtmlRendererForRichSegment | null | undefined;
let warned = false;

/** zhin 启动时已创建 renderer 时注入，避免 core 目录下 peer 解析失败 */
export function seedHtmlRenderer(renderer: HtmlRendererForRichSegment): void {
  cached = renderer;
}

/** 动态加载 @zhin.js/html-renderer；未安装时 warn 一次并返回 undefined */
export async function loadHtmlRenderer(
  opts?: LoadHtmlRendererOptions,
): Promise<HtmlRendererForRichSegment | undefined> {
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  try {
    const mod = await importOptionalPeerPackage<{
      createHtmlRenderer: (config?: Record<string, unknown>) => HtmlRendererForRichSegment;
    }>(HTML_RENDERER_PACKAGE);
    cached = mod.createHtmlRenderer(opts?.getConfig?.() ?? {}) as HtmlRendererForRichSegment;
    return cached;
  } catch {
    if (!warned) {
      warned = true;
      opts?.warn?.(
        `未安装 ${HTML_RENDERER_PACKAGE}，html/markdown=>image 已降级为 text。安装: pnpm add ${HTML_RENDERER_PACKAGE}`,
      );
    }
    cached = null;
    return undefined;
  }
}

/** 测试用：重置加载缓存 */
export function resetHtmlRendererLoaderForTests(): void {
  cached = undefined;
  warned = false;
}
