import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { execFileSync } from 'node:child_process';

interface SearchOptions {
  category?: string;
  limit?: number;
  official?: boolean;
}

export const searchCommand = new Command('search')
  .description('搜索 Zhin.js 插件')
  .argument('[keyword]', '搜索关键词')
  .option('-c, --category <category>', '按分类搜索 (utility|service|game|adapter|admin|ai)')
  .option('-l, --limit <number>', '限制结果数量', '20')
  .option('--official', '仅显示官方插件', false)
  .action(async (keyword: string, options: SearchOptions) => {
    try {
      logger.info('正在搜索插件...');
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

      // 使用 npm search（execFileSync 防止 shell 注入）
      try {
        const output = execFileSync('npm', ['search', searchQuery, '--json'], {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024, // 10MB
          stdio: ['pipe', 'pipe', 'ignore'] // 忽略 stderr
        });

        const results = JSON.parse(output);
        
        // 过滤结果
        let filteredResults = results.filter((pkg: any) => {
          // 必须包含 zhin 关键词
          const keywords = pkg.keywords || [];
          const hasZhin = keywords.includes('zhin') || 
                         keywords.includes('plugin') ||
                         pkg.name.startsWith('@zhin.js/') ||
                         pkg.name.startsWith('zhin.js-');
          
          if (!hasZhin) return false;

          // 按分类过滤
          if (options.category) {
            const category = pkg.keywords?.find((k: string) => 
              k.includes(options.category!)
            );
            if (!category) return false;
          }

          // 按关键词过滤
          if (keyword) {
            const searchIn = [
              pkg.name,
              pkg.description || '',
              ...(pkg.keywords || [])
            ].join(' ').toLowerCase();
            
            return searchIn.includes(keyword.toLowerCase());
          }

          return true;
        });

        // 限制结果数量
        const limit = parseInt(String(options.limit) || '20');
        if (filteredResults.length > limit) {
          filteredResults = filteredResults.slice(0, limit);
        }

        // 显示结果
        if (filteredResults.length === 0) {
          logger.warn('未找到匹配的插件');
          logger.log('');
          logger.log('💡 提示：');
          logger.log('  - 尝试使用不同的关键词');
          logger.log('  - 访问插件市场: https://zhin.pages.dev/plugins');
          logger.log('  - 在 GitHub 搜索: https://github.com/topics/zhin.js');
          return;
        }

        logger.success(`找到 ${filteredResults.length} 个插件：`);
        logger.log('');

        // 按下载量排序
        filteredResults.sort((a: any, b: any) => {
          const aDownloads = parseInt(a.downloads || '0');
          const bDownloads = parseInt(b.downloads || '0');
          return bDownloads - aDownloads;
        });

        // 显示插件列表
        filteredResults.forEach((pkg: any, index: number) => {
          const name = pkg.name;
          const version = pkg.version;
          const description = pkg.description || '无描述';
          const author = pkg.publisher?.username || '未知';
          const date = pkg.date ? new Date(pkg.date).toLocaleDateString('zh-CN') : '未知';
          
          // 判断插件类型
          let badge = '';
          if (name.startsWith('@zhin.js/')) {
            badge = '✨ [官方]';
          } else if (name.startsWith('zhin.js-')) {
            badge = '📦 [社区]';
          }

          logger.log(`${index + 1}. ${badge} ${name}@${version}`);
          logger.log(`   ${description}`);
          logger.log(`   作者: ${author} | 更新: ${date}`);
          
          // 显示安装命令
          logger.log(`   安装: zhin install ${name}`);
          logger.log('');
        });

        logger.log('💡 提示：');
        logger.log('  - 使用 zhin info <package> 查看插件详情');
        logger.log('  - 使用 zhin install <package> 安装插件');
        logger.log('  - 访问 https://zhin.pages.dev/plugins 查看完整列表');

      } catch (error) {
        logger.error('搜索失败，请检查网络连接');
        logger.log('');
        logger.log('💡 替代方案：');
        logger.log('  - 访问 npm: https://www.npmjs.com/search?q=zhin.js');
        logger.log('  - 访问 GitHub: https://github.com/topics/zhin.js');
        throw error;
      }

    } catch (error: any) {
      logger.error(`搜索插件失败: ${error.message}`);
      process.exit(1);
    }
  });

export const infoCommand = new Command('info')
  .description('查看插件详细信息')
  .argument('<package>', '插件包名')
  .action(async (packageName: string) => {
    try {
      logger.info(`正在获取 ${packageName} 的信息...`);
      logger.log('');

      const cmd = ['view', packageName, '--json'];
      
      try {
        const output = execFileSync('npm', cmd, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore']
        });

        const info = JSON.parse(output);
        
        // 显示插件信息
        logger.success('插件信息：');
        logger.log('');
        
        logger.log(`📦 名称: ${info.name}`);
        logger.log(`📝 版本: ${info.version}`);
        logger.log(`📄 描述: ${info.description || '无'}`);
        logger.log(`👤 作者: ${info.author?.name || info.maintainers?.[0]?.name || '未知'}`);
        logger.log(`📅 发布时间: ${new Date(info.time?.modified || info.time?.created).toLocaleDateString('zh-CN')}`);
        
        if (info.keywords?.length > 0) {
          logger.log(`🏷️  标签: ${info.keywords.join(', ')}`);
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
        if (info.peerDependencies) {
          logger.log('');
          logger.log('🔗 对等依赖:');
          Object.entries(info.peerDependencies).forEach(([dep, ver]) => {
            logger.log(`   ${dep}: ${ver}`);
          });
        }

        // 显示安装命令
        logger.log('');
        logger.log('📥 安装命令:');
        logger.log(`   zhin install ${info.name}`);
        logger.log(`   # 或`);
        logger.log(`   pnpm add ${info.name}`);

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
          if (info.zhin.features?.length > 0) {
            logger.log(`   功能: ${info.zhin.features.join(', ')}`);
          }
        }

      } catch (error) {
        logger.error(`未找到插件: ${packageName}`);
        logger.log('');
        logger.log('💡 提示：');
        logger.log('  - 检查插件名称是否正确');
        logger.log('  - 使用 zhin search 搜索插件');
        throw error;
      }

    } catch (error: any) {
      logger.error(`获取插件信息失败: ${error.message}`);
      process.exit(1);
    }
  });

