import fs from 'fs-extra';
import path from 'path';
import { InitOptions, buildRuntimeConfigDocument, serializeRuntimeConfig } from '@zhin.js/scaffold-wizard';

// 生成数据库环境变量（实现已收敛到 @zhin.js/scaffold-wizard，值统一走 formatEnvValue 转义）
export { generateDatabaseEnvVars } from '@zhin.js/scaffold-wizard';

/**
 * 创建新 Plugin Runtime 配置文件（configVersion 2、plugins 包映射与顶层实例业务配置，
 * 与 packages/im/runtime/src/config-composer.ts 的 effectiveSchema 对齐）
 */
export async function createConfigFile(appPath: string, format: string, options: InitOptions): Promise<void> {
  const configFormat = format === 'json' ? 'json' : 'yaml';
  const doc = buildRuntimeConfigDocument(options);
  const filename = configFormat === 'json'
    ? 'zhin.config.json'
    : 'zhin.config.yml';
  await fs.writeFile(path.join(appPath, filename), serializeRuntimeConfig(doc, configFormat));
}
