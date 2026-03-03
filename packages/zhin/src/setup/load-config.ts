import { ConfigLoader, ConfigFeature } from '@zhin.js/core';
import { LogLevel } from '@zhin.js/logger';
import type { AppConfig } from '../types.js';

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
  const configFeature = new ConfigFeature();
  configFeature.load(configFile, defaultConfig);
  const appConfig = configFeature.get<AppConfig>(configFile);
  return { configFeature, appConfig };
}
