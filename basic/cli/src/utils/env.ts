import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';

/**
 * 加载环境变量文件
 * 加载顺序：.env -> .env.${NODE_ENV}
 * 后加载的文件会覆盖前面的配置
 */
export function loadEnvFiles(cwd: string, nodeEnv: string): void {
  const envFiles = [
    '.env',
    `.env.${nodeEnv}`
  ];

  let loadedFiles: string[] = [];
  let totalVars = 0;

  for (const envFile of envFiles) {
    const envPath = path.join(cwd, envFile);
    
    if (fs.existsSync(envPath)) {
      try {
        const result = dotenv.config({ path: envPath });
        
        if (result.parsed) {
          const varCount = Object.keys(result.parsed).length;
          totalVars += varCount;
          loadedFiles.push(`${envFile} (${varCount} vars)`);
          
          // 在debug模式下显示详细信息
          if (process.env.ZHIN_DEBUG === 'true') {
            logger.debug(`已加载环境变量文件: ${envFile}`);
            Object.keys(result.parsed).forEach(key => {
              const value = result.parsed![key];
              const displayValue = key.toLowerCase().includes('password') || 
                                 key.toLowerCase().includes('secret') || 
                                 key.toLowerCase().includes('token') 
                                 ? '***' : value;
              logger.debug(`  - ${key}=${displayValue}`);
            });
          }
        }
      } catch (error) {
        logger.warn(`⚠️  加载环境变量文件 ${envFile} 失败: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  if (loadedFiles.length > 0) {
    logger.info(`🔧 已加载环境变量: ${loadedFiles.join(', ')} (共 ${totalVars} 个变量)`);
  } else {
    if (process.env.ZHIN_DEBUG === 'true') {
      logger.info('💡 未找到环境变量文件，使用系统环境变量');
    }
  }
}

/**
 * 获取环境变量优先级说明
 */
export function getEnvLoadOrder(nodeEnv: string): string[] {
  return [
    '.env (基础配置)',
    `.env.${nodeEnv} (${nodeEnv}环境特定配置，优先级更高)`
  ];
} 