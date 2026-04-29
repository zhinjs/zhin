import * as path from 'node:path';
import { ConfigLoader, ConfigFeature } from '@zhin.js/core';
import { LogLevel } from '@zhin.js/logger';
import type { AppConfig } from '../types.js';
import { setZhinProjectRoot } from './project-root.js';

const defaultConfig = {
  log_level: LogLevel.INFO,
  bots: [],
  database: {
    dialect: 'sqlite' as const,
    filename: './data/test.db',
  },
  plugin_dirs: ['node_modules', './src/plugins'],
  plugins: ['@zhin.js/http', '@zhin.js/console', '@zhin.js/adapter-sandbox'],
  services: ['process', 'config', 'command', 'component', 'permission', 'cron'] as const,
};

/**
 * 发现并加载配置文件，返回 ConfigFeature 与合并后的应用配置
 */
export function loadConfig(): { configFeature: ConfigFeature; appConfig: AppConfig } {
  const configFile = ConfigLoader.discover('zhin.config') || 'zhin.config.yml';
  const resolvedConfigPath = path.resolve(process.cwd(), configFile);
  const envRoot = process.env.ZHIN_PROJECT_ROOT?.trim();
  setZhinProjectRoot(envRoot ? path.resolve(envRoot) : path.dirname(resolvedConfigPath));
  const configFeature = new ConfigFeature();
  configFeature.load(configFile, defaultConfig);
  const appConfig = configFeature.get<AppConfig>(configFile);
  return { configFeature, appConfig };
}
