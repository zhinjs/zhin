import fs from 'node:fs';
import path from 'node:path';

export interface QqCredentialEnvKeys {
  appidKey: string;
  secretKey: string;
  appidRef: string;
  secretRef: string;
}

/** 按 endpoint 名称生成唯一 env 键（如 `QQ_MY_BOT_APPID`） */
export function buildQqCredentialEnvKeys(endpointName: string): QqCredentialEnvKeys {
  const slug = endpointName.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
  const appidKey = `QQ_${slug}_APPID`;
  const secretKey = `QQ_${slug}_SECRET`;
  return {
    appidKey,
    secretKey,
    appidRef: `\${${appidKey}}`,
    secretRef: `\${${secretKey}}`,
  };
}

/** 项目根：ZHIN_PROJECT_ROOT 优先，缺省 process.cwd()（替代 legacy runtimeCwd） */
export function resolveProjectRoot(): string {
  const envRoot = process.env.ZHIN_PROJECT_ROOT?.trim();
  return path.resolve(envRoot || process.cwd());
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertEnvLine(content: string, key: string, value: string): string {
  const lineRe = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, 'm');
  const newLine = `${key}=${value}`;
  if (lineRe.test(content)) {
    return content.replace(lineRe, newLine);
  }
  const trimmed = content.replace(/\s*$/, '');
  if (trimmed.length === 0) {
    return `${newLine}\n`;
  }
  return `${trimmed}\n${newLine}\n`;
}

/** 写入或更新 `.env` 中的键值，并同步到当前进程 `process.env` */
export function persistQqCredentialsToEnv(
  endpointName: string,
  appId: string,
  appSecret: string,
  projectRoot?: string,
): QqCredentialEnvKeys {
  const keys = buildQqCredentialEnvKeys(endpointName);
  const root = projectRoot ?? resolveProjectRoot();
  const envPath = path.join(root, '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

  const entries: Record<string, string> = {
    [keys.appidKey]: appId,
    [keys.secretKey]: appSecret,
  };

  for (const [key, value] of Object.entries(entries)) {
    content = upsertEnvLine(content, key, value);
    process.env[key] = value;
  }

  fs.writeFileSync(envPath, content);
  return keys;
}
