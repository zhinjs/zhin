import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import {
  ROOT_CONFIG_FILE_NAMES,
  rootConfigFormat,
  selectRootConfigFile,
} from '@zhin.js/plugin-runtime';

export function findConfigFile(cwd: string): string | null {
  const existing = ROOT_CONFIG_FILE_NAMES
    .filter((name) => fs.existsSync(path.join(cwd, name)));
  const selected = selectRootConfigFile(existing);
  return selected ?? null;
}

export async function readConfig(filePath: string): Promise<Record<string, unknown>> {
  const format = rootConfigFormat(filePath);
  const content = await fs.readFile(filePath, 'utf-8');

  if (format === 'yaml') {
    const parsed = yaml.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  }
  if (format === 'json') {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  }
  throw new Error(`不支持的 Root 配置文件格式: ${path.extname(filePath) || '(无扩展名)'}`);
}

export async function saveConfig(filePath: string, config: Record<string, unknown>): Promise<void> {
  const format = rootConfigFormat(filePath);

  if (format === 'yaml') {
    await fs.writeFile(filePath, yaml.stringify(config));
    return;
  }
  if (format === 'json') {
    await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`);
    return;
  }
  throw new Error(`不支持写入 ${path.extname(filePath) || '(无扩展名)'} Root 配置文件`);
}
