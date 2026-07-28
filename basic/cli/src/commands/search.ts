import { Command } from 'commander';
import { formatCompact } from '@zhin.js/logger';
import { logger } from '../utils/logger.js';
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
    logger.info(formatCompact( { cmd: 'search', op: 'search' }));
    logger.log('');

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
        logger.warn(formatCompact( { cmd: 'search', op: 'no_results' }));
        logger.log('');
        logger.log('💡 提示：');
        logger.log('  - 尝试使用不同的关键词');
        logger.log('  - 访问插件市场: https://zhin.pages.dev/plugins');
        logger.log('  - 在 GitHub 搜索: https://github.com/topics/zhin.js');
        return;
      }

      logger.success(`找到 ${filteredResults.length} 个插件：`);
      logger.log('');

      // 显示插件列表
      filteredResults.forEach((pkg, index: number) => {
        const name = pkg.name;
        const version = pkg.version;
        const description = pkg.description || '无描述';
        const author = pkg.publisher?.username || '未知';
        const date = pkg.date ? new Date(pkg.date).toLocaleDateString('zh-CN') : '未知';

        const badge = formatPackageBadge(classifyPackage(pkg));

        logger.log(`${index + 1}. ${badge} ${name}@${version}`);
        logger.log(`   ${description}`);
        logger.log(`   作者: ${author} | 更新: ${date}`);

        // 显示安装命令
        logger.log(`   安装: zhin packages install ${name}`);
        logger.log('');
      });

      logger.log('💡 提示：');
      logger.log('  - 使用 zhin packages info <package> 查看插件详情');
      logger.log('  - 使用 zhin packages install <package> 安装插件');
      logger.log('  - 访问 https://zhin.pages.dev/plugins 查看完整列表');

    } catch (error) {
      logger.error('搜索失败，请检查网络连接');
      logger.log('');
      logger.log('💡 替代方案：');
      logger.log('  - 访问 npm: https://www.npmjs.com/search?q=zhin.js');
      logger.log('  - 访问 GitHub: https://github.com/topics/zhin.js');
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
    logger.info(formatCompact( { cmd: 'info', op: 'fetch', package: packageName }));
    logger.log('');

    try {
      const info = npmView(packageName);
      const weeklyDownloads = await fetchWeeklyDownloads(packageName);
      const badge = formatPackageBadge(classifyPackage(info));

      // 显示插件信息
      logger.success(`插件信息： ${badge}`);
      logger.log('');

      logger.log(`📦 名称: ${info.name}`);
      logger.log(`📝 版本: ${info.version}`);
      logger.log(`📄 描述: ${info.description || '无'}`);
      logger.log(`👤 作者: ${info.author?.name || info.maintainers?.[0]?.name || '未知'}`);
      const publishedAt = info.time?.modified ?? info.time?.created;
      logger.log(`📅 发布时间: ${publishedAt
        ? new Date(publishedAt).toLocaleDateString('zh-CN')
        : '未知'}`);
      if (weeklyDownloads !== null) {
        logger.log(`📈 周下载量: ${weeklyDownloads}`);
      }

      const keywords = info.keywords ?? [];
      if (keywords.length > 0) {
        logger.log(`🏷️  标签: ${keywords.join(', ')}`);
      }

      if (info.homepage) {
        logger.log(`🏠 主页: ${info.homepage}`);
      }

      if (info.repository?.url) {
        logger.log(`📂 仓库: ${info.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')}`);
      }

      if (info.bugs?.url) {
        logger.log(`🐛 问题: ${info.bugs.url}`);
      }

      if (info.license) {
        logger.log(`⚖️  许可: ${info.license}`);
      }

      // 显示依赖
      const dependencies = { ...(info.dependencies || {}), ...(info.peerDependencies ? Object.fromEntries(Object.entries(info.peerDependencies).map(([k, v]) => [`${k} (peer)`, v])) : {}) };
      const depEntries = Object.entries(dependencies);
      if (depEntries.length > 0) {
        logger.log('');
        logger.log('🔗 依赖:');
        depEntries.forEach(([dep, ver]) => {
          logger.log(`   ${dep}: ${ver}`);
        });
      }

      // Zhin 特定信息
      if (info.zhin) {
        logger.log('');
        logger.log('🎯 Zhin 信息:');
        if (info.zhin.displayName) {
          logger.log(`   显示名称: ${info.zhin.displayName}`);
        }
        if (info.zhin.category) {
          logger.log(`   分类: ${info.zhin.category}`);
        }
        const features = info.zhin.features ?? [];
        if (features.length > 0) {
          logger.log(`   功能: ${features.join(', ')}`);
        }
      }

      // 官方适配器：追加配置入口提示
      const adapterHint = adapterConfigHintForPackage(info.name);
      if (adapterHint) {
        logger.log('');
        logger.log('🧭 适配器配置入口:');
        logger.log(`   ${adapterHint}`);
      }

      // 显示安装命令
      logger.log('');
      logger.log('📥 安装命令:');
      logger.log(`   zhin packages install ${info.name}`);
      logger.log(`   # 或`);
      logger.log(`   pnpm add ${info.name}`);

    } catch (error) {
      logger.error(`未找到插件: ${packageName}`);
      logger.log('');
      logger.log('💡 提示：');
      logger.log('  - 检查插件名称是否正确');
      logger.log('  - 使用 zhin packages search 搜索插件');
      throw error;
    }

  } catch (error: unknown) {
    logger.error(`获取插件信息失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export const searchCommand = new Command('search')
  .description('搜索 Zhin.js 插件（等价于 zhin packages search）')
  .argument('[keyword]', '搜索关键词')
  .option('-c, --category <category>', '按分类搜索 (utility|service|game|adapter|admin|ai)')
  .option('-l, --limit <number>', '限制结果数量', '20')
  .option('--official', '仅显示官方插件', false)
  .action(runPluginSearch);

export const infoCommand = new Command('info')
  .description('查看插件详细信息（等价于 zhin packages info）')
  .argument('<package>', '插件包名')
  .action(runPluginInfo);
