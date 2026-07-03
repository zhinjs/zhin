import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigLoader, ConfigFeature, runtimeCwd } from '@zhin.js/core';
import { LogLevel } from '@zhin.js/logger';
import type { AppConfig } from '../types.js';
import { setZhinProjectRoot } from './project-root.js';

export const DEFAULT_CORE_SERVICES = ['process', 'config', 'command', 'component', 'permission', 'schedule'] as const;

export const DEFAULT_APP_CONFIG: AppConfig = {
  log_level: LogLevel.INFO,
  endpoints: [],
  database: {
    dialect: 'sqlite' as const,
    filename: './data/bot.db',
  },
  plugin_dirs: ['node_modules', './src/plugins'],
  plugins: ['@zhin.js/adapter-sandbox'],
  services: [...DEFAULT_CORE_SERVICES],
};

export type LoadConfigOptions = {
  /** 机器人项目根（与 zhin.config.* 同目录）；bootstrap 传入时优先于 cwd 发现 */
  projectRoot?: string;
  /** 与配置文件合并的默认值 */
  defaults?: AppConfig;
};

/**
 * 发现并加载配置文件，返回 ConfigFeature 与合并后的应用配置
 */
export function loadConfig(
  options: LoadConfigOptions = {},
): { configFeature: ConfigFeature; appConfig: AppConfig; configPath: string } {
  const envRoot = envLookup('ZHIN_PROJECT_ROOT')?.trim();
  const root = path.resolve(
    options.projectRoot ?? envRoot ?? runtimeCwd(),
  );
  setZhinProjectRoot(root);
  const configFile = options.projectRoot
    ? (discoverConfigInRoot(root, 'zhin.config') ?? 'zhin.config.yml')
    : (ConfigLoader.discover('zhin.config', root) ?? 'zhin.config.yml');
  const configPath = path.resolve(root, configFile);
  const configFeature = new ConfigFeature();
  const defaults = options.defaults ?? DEFAULT_APP_CONFIG;
  configFeature.load(configFile, defaults, undefined, root);
  const appConfig = configFeature.getPrimary<AppConfig>();
  return { configFeature, appConfig, configPath };
}

function discoverConfigInRoot(root: string, basename: string): string | null {
  for (const ext of ['.yml', '.yaml', '.json', '.toml']) {
    const name = `${basename}${ext}`;
    if (fs.existsSync(path.join(root, name))) {
      return name;
    }
  }
  return null;
}

function envLookup(key: string): string | undefined {
  const g = globalThis as {
    Deno?: { env: { get: (k: string) => string | undefined } };
    process?: { env: Record<string, string | undefined> };
  };
  return g.Deno?.env.get(key) ?? g.process?.env?.[key];
}
