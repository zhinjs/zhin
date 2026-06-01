import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export type QBotConfig = {
  botId: string;
  namespace?: string;
};

/** 读取项目根目录 qbot.config.yml（Plan 4 spike：独立于 zhin.config 的 queue 配置） */
export function loadQBotConfig(cwd = process.cwd()): QBotConfig {
  const filePath = path.join(cwd, 'qbot.config.yml');
  const raw = readFileSync(filePath, 'utf8');
  const data = parse(raw) as Partial<QBotConfig>;
  if (!data?.botId || typeof data.botId !== 'string') {
    throw new Error(`qbot.config.yml 缺少 botId（${filePath}）`);
  }
  return { botId: data.botId, namespace: data.namespace };
}
