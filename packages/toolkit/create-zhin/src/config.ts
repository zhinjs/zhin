import fs from 'fs-extra';
import path from 'path';
import { InitOptions, buildRuntimeConfigDocument, serializeRuntimeConfig } from '@zhin.js/scaffold-wizard';

// 生成数据库环境变量（实现已收敛到 @zhin.js/scaffold-wizard，值统一走 formatEnvValue 转义）
export { generateDatabaseEnvVars } from '@zhin.js/scaffold-wizard';

/**
 * 创建新 Plugin Runtime 配置文件（顶层 http/database/ai + plugins.<instanceKey>，
 * 与 packages/im/runtime/src/config-composer.ts 的 effectiveSchema 对齐）
 */
export async function createConfigFile(appPath: string, format: string, options: InitOptions): Promise<void> {
  const configFormat = (format === 'json' || format === 'toml' ? format : 'yaml') as 'yaml' | 'json' | 'toml';
  const doc = buildRuntimeConfigDocument(options);
  const filename = configFormat === 'json'
    ? 'zhin.config.json'
    : configFormat === 'toml'
      ? 'zhin.config.toml'
      : 'zhin.config.yml';
  await fs.writeFile(path.join(appPath, filename), serializeRuntimeConfig(doc, configFormat));
}
