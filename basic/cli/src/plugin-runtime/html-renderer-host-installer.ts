import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { htmlRendererToken, type HtmlRendererHost } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

const logger = getLogger('HtmlRenderer');

/** string 类型标注：避免 TS 将字面量 const 当静态依赖解析（optional peer）。 */
const HTML_RENDERER_PACKAGE: string = '@zhin.js/html-renderer';

interface HtmlRendererModule {
  createHtmlRenderer(
    config?: Record<string, unknown>,
    logger?: {
      debug?(...args: unknown[]): void;
      warn?(...args: unknown[]): void;
      info?(...args: unknown[]): void;
    },
  ): HtmlRendererHost;
}

/**
 * Optional HtmlRenderer Host：动态加载 `@zhin.js/html-renderer`，
 * 未安装时返回 undefined（core 出站规范化降级为纯文本，不报错）。
 */
export async function prepareHtmlRendererHost(): Promise<HtmlRendererHost | undefined> {
  try {
    const mod = await importHtmlRendererModule();
    const host = mod.createHtmlRenderer({}, {
      debug: (...args) => logger.debug(args.map(String).join(' ')),
      warn: (...args) => logger.warn(args.map(String).join(' ')),
    });
    logger.debug(formatCompact({ op: 'html_renderer_ready' }));
    return host;
  } catch (error) {
    logger.debug(formatCompact({
      op: 'html_renderer_skip',
      reason: 'package_unavailable',
      error: error instanceof Error ? error.message : String(error),
    }));
    return undefined;
  }
}

export function installHtmlRendererHost(host: HtmlRendererHost | undefined): RootResourceInstaller {
  return ({ resources }) => {
    if (!host) return;
    resources.provide(htmlRendererToken, host);
  };
}

/** 优先从应用根（ZHIN_PROJECT_ROOT / cwd）解析 optional peer，回退裸 specifier。 */
async function importHtmlRendererModule(): Promise<HtmlRendererModule> {
  const roots = new Set<string>();
  const envRoot = process.env.ZHIN_PROJECT_ROOT?.trim();
  if (envRoot) roots.add(envRoot);
  roots.add(process.cwd());
  for (const root of roots) {
    try {
      // createRequire 走 CJS 条件，而该包 exports 只声明 import/development，
      // 故解析其 package.json 再按 exports['.'].import 拼入口文件。
      const manifestPath = createRequire(join(root, 'package.json'))
        .resolve(`${HTML_RENDERER_PACKAGE}/package.json`);
      const manifest = JSON.parse(
        readFileSync(manifestPath, 'utf8'),
      ) as { exports?: Record<string, Record<string, string>> };
      const entry = manifest.exports?.['.']?.import ?? './lib/index.js';
      const entryUrl = pathToFileURL(join(dirname(manifestPath), entry)).href;
      return await import(entryUrl) as HtmlRendererModule;
    } catch {
      // try next root
    }
  }
  return await import(HTML_RENDERER_PACKAGE) as HtmlRendererModule;
}
