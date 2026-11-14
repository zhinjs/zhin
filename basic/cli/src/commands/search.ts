import { Command } from 'commander';
import { formatCompact } from '@zhin.js/logger';
import {
  PLUGIN_CATEGORIES,
  PLUGIN_CATEGORY_LABELS,
  informativeKeywords,
  packageAuthorName,
  pickLocalizedText,
  readPluginMarketplaceMetadata,
} from '@zhin.js/plugin-runtime';
import { logger } from '../utils/logger.js';
import { output } from '../utils/output.js';
import {
  findInstalledPackageRoot,
  formatConfigField,
  manifestFeatureNames,
  packageAuthors,
  readPackageCapabilities,
} from '../utils/package-capabilities.js';
import {
  classifyPackage,
  fetchWeeklyDownloads,
  filterSearchResults,
  formatPackageBadge,
  adapterConfigHintForPackage,
  npmSearch,
  npmView,
} from '../utils/plugin-registry.js';

interface SearchOptions {
  category?: string;
  limit?: number;
  official?: boolean;
}

/**
 * 搜索 Zhin.js 插件（npm registry），供 `zhin search` 与 `zhin packages search` 共用
 */
export async function runPluginSearch(keyword: string | undefined, options: SearchOptions) {
  try {
    logger.debug(formatCompact( { cmd: 'search', op: 'search' }));

    // 构建搜索查询
    let searchQuery = 'zhin';

    if (options.official) {
      searchQuery = '@zhin.js';
    } else if (keyword) {
      searchQuery = `zhin.js ${keyword} `;
    } else {
      searchQuery = 'zhin.js plugin';
    }

    try {
      const results = npmSearch(searchQuery);
      const limit = parseInt(String(options.limit) || '20', 10);
      const filteredResults = filterSearchResults(results, {
        keyword,
        category: options.category,
        limit,
      });

      // 显示结果
      if (filteredResults.length === 0) {
        logger.warn('没有找到匹配的插件');
        output.line('💡 提示：');
        output.line('  - 尝试使用不同的关键词');
        output.line('  - 在 npm 按关键词浏览: https://www.npmjs.com/search?q=keywords%3Azhin.js');
        output.line('  - 在 GitHub 搜索: https://github.com/topics/zhin.js');
        return;
      }

      output.line(`找到 ${filteredResults.length} 个插件：`);
      output.line();

      // 显示插件列表
      filteredResults.forEach((pkg, index: number) => {
        const name = pkg.name;
        const version = pkg.version;
        const market = readPluginMarketplaceMetadata(pkg.zhin);
        const description = pickLocalizedText(market.descriptionI18n, 'zh-CN', pkg.description) || '无描述';
        // 作者取 package.json 的 author / maintainers；publisher 是发布账号（CI 发布时为机器人），不显示。
        const author = packageAuthorName(pkg) || '未知';
        const date = pkg.date ? new Date(pkg.date).toLocaleDateString('zh-CN') : '未知';

        const badge = formatPackageBadge(classifyPackage(pkg));

        output.line(`${index + 1}. ${badge} ${name}@${version}`);
        output.line(`   ${description}`);
        output.line(`   作者: ${author} | 更新: ${date}`);

        // 显示安装命令
        output.line(`   安装: zhin packages install ${name}`);
        output.line();
      });

      output.line('💡 提示：');
      output.line('  - 使用 zhin packages info <package> 查看插件详情');
      output.line('  - 使用 zhin packages install <package> 安装插件');
      output.line('  - 访问 https://www.npmjs.com/search?q=keywords%3Azhin.js 查看完整列表');

    } catch (error) {
      logger.error('搜索失败，请检查网络连接');
      logger.info('💡 替代方案：\n  - 访问 npm: https://www.npmjs.com/search?q=zhin.js\n  - 访问 GitHub: https://github.com/topics/zhin.js');
      throw error;
    }

  } catch (error: unknown) {
    logger.error(`搜索插件失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * 查看插件详情（npm registry），供 `zhin info` 与 `zhin packages info` 共用
 */
export async function runPluginInfo(packageName: string) {
  try {
    logger.debug(formatCompact( { cmd: 'info', op: 'fetch', package: packageName }));

    try {
      const info = npmView(packageName);
      const weeklyDownloads = await fetchWeeklyDownloads(packageName);
      const badge = formatPackageBadge(classifyPackage(info));

      // 显示插件信息
      output.line(`插件信息： ${badge}`);
      output.line();

      output.line(`📦 名称: ${info.name}`);
      output.line(`📝 版本: ${info.version}`);
      const market = readPluginMarketplaceMetadata(info.zhin);
      const displayName = pickLocalizedText(market.displayNameI18n, 'zh-CN', market.displayName);
      if (displayName) output.line(`🏷️  显示名称: ${displayName}`);
      output.line(`📄 描述: ${pickLocalizedText(market.descriptionI18n, 'zh-CN', info.description) || '无'}`);
      if (market.category) {
        output.line(`🗂️  分类: ${PLUGIN_CATEGORY_LABELS[market.category]['zh-CN']}（${market.category}）`);
      }
      // packageAuthors 取 npm person 字符串 `<` / `(` 之前的部分（CodeQL 安全写法），不显示发布账号。
      const authors = packageAuthors(info);
      output.line(`👤 作者: ${authors.length > 0 ? authors.join(', ') : '未知'}`);
      const publishedAt = info.time?.modified ?? info.time?.created;
      output.line(`📅 发布时间: ${publishedAt
        ? new Date(publishedAt).toLocaleDateString('zh-CN')
        : '未知'}`);
      if (weeklyDownloads !== null) {
        output.line(`📈 周下载量: ${weeklyDownloads}`);
      }

      const keywords = informativeKeywords(info.keywords);
      if (keywords.length > 0) {
        output.line(`🏷️  标签: ${keywords.join(', ')}`);
      }

      if (info.homepage) {
        output.line(`🏠 主页: ${info.homepage}`);
      }

      if (info.repository?.url) {
        output.line(`📂 仓库: ${info.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')}`);
      }

      if (info.bugs?.url) {
        output.line(`🐛 问题: ${info.bugs.url}`);
      }

      if (info.license) {
        output.line(`⚖️  许可: ${info.license}`);
      }

      // 显示依赖
      const dependencies = { ...(info.dependencies || {}), ...(info.peerDependencies ? Object.fromEntries(Object.entries(info.peerDependencies).map(([k, v]) => [`${k} (peer)`, v])) : {}) };
      const depEntries = Object.entries(dependencies);
      if (depEntries.length > 0) {
        output.line();
        output.line('🔗 依赖:');
        depEntries.forEach(([dep, ver]) => {
          output.line(`   ${dep}: ${ver}`);
        });
      }

      // Zhin 特定信息（显示名称与分类已在上方按市场元数据展示）
      const features = manifestFeatureNames((info.zhin as { features?: unknown } | undefined)?.features);
      if (features.length > 0) {
        output.line();
        output.line('🎯 Zhin 信息:');
        output.line(`   功能: ${features.join(', ')}`);
      }

      await printPackageCapabilities(info.name);

      // 官方适配器：追加配置入口提示
      const adapterHint = adapterConfigHintForPackage(info.name);
      if (adapterHint) {
        output.line();
        output.line('🧭 适配器配置入口:');
        output.line(`   ${adapterHint}`);
      }

      // 显示安装命令
      output.line();
      output.line('📥 安装命令:');
      output.line(`   zhin packages install ${info.name}`);
      output.line(`   # 或`);
      output.line(`   pnpm add ${info.name}`);

    } catch (error) {
      logger.error(`未找到插件: ${packageName}`);
      logger.info('💡 提示：\n  - 检查插件名称是否正确\n  - 使用 zhin packages search 搜索插件');
      throw error;
    }

  } catch (error: unknown) {
    logger.error(`获取插件信息失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * 命令 / Agent 工具 / 配置项（#1250）：从当前项目已安装的包静态读取（约定目录与 schema.json），
 * 不执行插件代码；未安装时说明如何查看。
 */
export async function printPackageCapabilities(packageName: string, cwd = process.cwd()): Promise<void> {
  const root = findInstalledPackageRoot(packageName, cwd);
  output.line();
  if (!root) {
    output.line('🧩 命令 / Agent 工具 / 配置项: 未安装到当前项目，安装后再运行本命令即可查看');
    return;
  }
  const capabilities = await readPackageCapabilities(root);
  output.line(`⌨️  命令${capabilities.commands.length ? `（${capabilities.commands.length}）` : ''}:`);
  output.line(...(capabilities.commands.length ? capabilities.commands.map((command) => `   ${command}`) : ['   无']));
  output.line(`🛠️  Agent 工具${capabilities.tools.length ? `（${capabilities.tools.length}）` : ''}:`);
  output.line(...(capabilities.tools.length ? capabilities.tools.map((tool) => `   ${tool}`) : ['   无']));
  output.line('⚙️  配置项:');
  if (capabilities.config === null) output.line('   未声明（包内没有 schema.json）');
  else output.line(...(capabilities.config.length ? capabilities.config.map((field) => `   ${formatConfigField(field)}`) : ['   无']));
}

export const searchCommand = new Command('search')
  .description('搜索 Zhin.js 插件（等价于 zhin packages search）')
  .argument('[keyword]', '搜索关键词')
  .option('-c, --category <category>', `按分类搜索 (${PLUGIN_CATEGORIES.join('|')})`)
  .option('-l, --limit <number>', '限制结果数量', '20')
  .option('--official', '仅显示官方插件', false)
  .action(runPluginSearch);

export const infoCommand = new Command('info')
  .description('查看插件详细信息（等价于 zhin packages info）')
  .argument('<package>', '插件包名')
  .action(runPluginInfo);
