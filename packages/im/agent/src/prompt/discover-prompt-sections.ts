import * as path from 'node:path';
import { getLogger } from '@zhin.js/logger';
import { PromptSectionLoader, type PromptSectionLoaderOptions } from './prompt-section-loader.js';
import type { PromptAssemblyRegistry } from './prompt-assembly-registry.js';

const logger = getLogger('PromptSectionDiscovery');

const CONVENTION_SUBDIR = 'agent/prompt-sections';

/**
 * 从一批插件根目录中发现并注册提示词节点。
 *
 * @returns 成功注册的节点总数
 */
export async function discoverAndRegisterPromptSections(
  pluginRootDirs: string[],
  registry: PromptAssemblyRegistry,
  options?: PromptSectionLoaderOptions,
): Promise<number> {
  const loader = new PromptSectionLoader();
  const subdir = options?.subdir ?? CONVENTION_SUBDIR;
  let count = 0;

  for (const root of pluginRootDirs) {
    const dirPath = path.join(root, subdir);
    const sections = await loader.loadFromDir(dirPath, { strict: options?.strict });
    await loader.registerToRegistry(sections, registry);
    count += sections.length;
  }

  return count;
}

/**
 * 在 Agent 初始化时调用，自动从 ctx 中获取所有插件根目录，
 * 扫描 `agent/prompt-sections/` 目录并注册到 registry。
 *
 * ctx 需要提供 `getPluginRoots()` 或 `plugins`（含 `root` 属性）。
 */
export async function bootstrapPromptSections(
  ctx: {
    getPluginRoots?: () => string[];
    plugins?: Array<{ root?: string }>;
  },
  registry: PromptAssemblyRegistry,
  options?: PromptSectionLoaderOptions,
): Promise<void> {
  let roots: string[];

  if (typeof ctx.getPluginRoots === 'function') {
    roots = ctx.getPluginRoots();
  } else if (Array.isArray(ctx.plugins)) {
    roots = ctx.plugins
      .map(p => p.root)
      .filter((r): r is string => typeof r === 'string');
  } else {
    roots = [];
  }

  if (roots.length === 0) {
    logger.debug('[bootstrapPromptSections] no plugin roots found — skipping discovery');
    return;
  }

  const count = await discoverAndRegisterPromptSections(roots, registry, options);
  logger.debug(`[bootstrapPromptSections] discovered ${count} prompt section(s) from ${roots.length} plugin(s)`);
}
