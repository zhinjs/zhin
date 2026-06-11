import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

const LEGACY_TS_CANDIDATE = 'zhin.config.ts';
const CONFIG_EXTENSIONS = ['.yml', '.yaml', '.json', '.toml'] as const;

function discoverConfigBasename(basename: string, cwd: string): string | null {
  for (const ext of CONFIG_EXTENSIONS) {
    const name = `${basename}${ext}`;
    if (fs.existsSync(path.join(cwd, name))) {
      return name;
    }
  }
  return null;
}

export function findConfigFile(cwd: string): string | null {
  return discoverConfigBasename('zhin.config', cwd)
    ?? (fs.existsSync(path.join(cwd, LEGACY_TS_CANDIDATE)) ? LEGACY_TS_CANDIDATE : null);
}

export function hasLegacyTsConfig(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, LEGACY_TS_CANDIDATE))
    && !discoverConfigBasename('zhin.config', cwd);
}

export async function readConfig(filePath: string): Promise<Record<string, unknown>> {
  const ext = path.extname(filePath).toLowerCase();
  const content = await fs.readFile(filePath, 'utf-8');

  if (ext === '.yml' || ext === '.yaml') {
    const parsed = yaml.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  }
  if (ext === '.json') {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  }
  if (ext === '.toml') {
    const parsed = parseToml(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  }
  if (ext === '.ts') {
    return {};
  }
  return {};
}

export async function saveConfig(filePath: string, config: Record<string, unknown>): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.yml' || ext === '.yaml') {
    await fs.writeFile(filePath, yaml.stringify(config));
    return;
  }
  if (ext === '.json') {
    await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`);
    return;
  }
  if (ext === '.toml') {
    await fs.writeFile(filePath, stringifyToml(config as Record<string, unknown>));
    return;
  }
  throw new Error(`不支持写入 ${ext} 配置文件，请迁移为 zhin.config.yml`);
}
