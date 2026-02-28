/**
 * send — 在 daemon 运行时向指定平台发送消息（借鉴 OpenClaw message send）
 *
 * 调用运行中实例的 HTTP API POST /api/message/send，需启用 @zhin.js/http。
 * 默认 --scene private，--adapter process（sandbox）。
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { logger } from '../utils/logger.js';

const cwd = process.cwd();

const CONFIG_CANDIDATES = ['zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json'];

function findConfigFile(dir: string): string | null {
  return CONFIG_CANDIDATES.find((f) => fs.existsSync(path.join(dir, f))) ?? null;
}

async function readConfig(filePath: string): Promise<any> {
  const content = await fs.readFile(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.json' ? JSON.parse(content) : yaml.parse(content);
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function loadHttpOptions(): Promise<{ baseUrl: string; token: string } | null> {
  const configFile = findConfigFile(cwd);
  if (!configFile) return null;
  const config = await readConfig(path.join(cwd, configFile));
  const http = config?.http || {};
  const port = http.port ?? 8086;
  const host = http.host ?? '127.0.0.1';
  const base = (http.base ?? '/api').replace(/^\/+|\/+$/g, '') || 'api';
  const baseUrl = `http://${host}:${port}/${base}`;

  const envPath = path.join(cwd, '.env');
  const env = fs.existsSync(envPath) ? parseEnv(await fs.readFile(envPath, 'utf-8')) : {};

  let token = http.token ?? '';
  if (typeof token === 'string' && token.startsWith('${') && token.endsWith('}')) {
    const key = token.slice(2, -1).trim();
    token = env[key] ?? process.env[key] ?? '';
  }

  return { baseUrl, token: String(token) };
}

async function getFirstBotForAdapter(baseUrl: string, token: string, adapter: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/bots`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { name: string; adapter: string }[] };
    const bot = json.data?.find((b) => b.adapter === adapter);
    return bot?.name ?? null;
  } catch {
    return null;
  }
}

export const sendCommand = new Command('send')
  .description('向 daemon 运行中的机器人指定场景发送消息（需启用 HTTP 服务）')
  .argument('<scene_id>', '场景 ID（私聊为用户 ID，群聊为群号等）')
  .argument('[content...]', '消息内容（可多词，用空格连接）；不传则从 stdin 读取一行')
  .option('-s, --scene <type>', '场景类型：private | group | channel', 'private')
  .option('-a, --adapter <name>', '适配器名称（icqq、discord、process 等），默认 process', 'process')
  .option('-b, --bot <id>', '指定 Bot ID，不传则使用该适配器下第一个在线 Bot')
  .action(async (sceneId: string, contentParts: string[]) => {
    const opts = sendCommand.opts();
    const sceneType = (opts.scene as string) || 'private';
    const adapterName = (opts.adapter as string) || 'process';
    const botId = opts.bot as string | undefined;

    let content: string;
    if (Array.isArray(contentParts) && contentParts.length > 0) {
      content = contentParts.join(' ');
    } else if (!process.stdin.isTTY) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      content = Buffer.concat(chunks).toString('utf-8').trim();
      if (!content) {
        logger.error('stdin 为空，请提供消息内容');
        process.exit(1);
      }
    } else {
      logger.error('请提供消息内容：作为参数传入或通过管道输入，例如 echo "hello" | zhin send <scene_id>');
      process.exit(1);
    }

    const httpOpts = await loadHttpOptions();
    if (!httpOpts) {
      logger.error('未找到 zhin 配置文件，无法确定 HTTP 地址');
      process.exit(1);
    }

    const token = httpOpts.token;
    let bot_id   = botId;
    if (!bot_id) {
      const bot = await getFirstBotForAdapter(httpOpts.baseUrl, token, adapterName);
      if (!bot) {
        logger.error(`未找到适配器 "${adapterName}" 下的 Bot，请使用 --bot <id> 指定`);
        process.exit(1);
      }
      bot_id = bot
    }

    const body = {
      context: adapterName,
      bot: bot_id,
      id: sceneId,
      type: sceneType,
      content,
    };

    try {
      const res = await fetch(`${httpOpts.baseUrl}/message/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: { messageId?: string } };
      if (!res.ok) {
        logger.error(data.error || `HTTP ${res.status}`);
        process.exit(1);
      }
      if (!data.success) {
        logger.error(data.error || '发送失败');
        process.exit(1);
      }
      console.log(chalk.green('已发送'));
      if (data.data?.messageId) {
        console.log(chalk.gray('  messageId: ' + data.data.messageId));
      }
    } catch (e: any) {
      logger.error(e?.message || String(e));
      process.exit(1);
    }
  });
