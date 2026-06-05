/**
 * send — 在 daemon 运行时向指定平台发送消息（借鉴 OpenClaw message send）
 *
 * 调用运行中实例的 HTTP API POST /api/message/send，需启用 @zhin.js/host-router。
 * 默认 --scene private，--adapter process（sandbox）。
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { hostGet, loadHostHttpConfig } from '../utils/host-http.js';

async function getFirstBotForAdapter(
  baseUrl: string,
  token: string,
  adapter: string,
): Promise<string | null> {
  const res = await hostGet<{ name: string; adapter: string }[]>(
    { baseUrl, token },
    '/bots',
  );
  if (!res.ok || !Array.isArray(res.data)) return null;
  const bot = res.data.find((b) => b.adapter === adapter);
  return bot?.name ?? null;
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

    const httpOpts = await loadHostHttpConfig();
    if (!httpOpts) {
      logger.error('未找到 zhin 配置文件，无法确定 HTTP 地址');
      process.exit(1);
    }

    const token = httpOpts.token;
    let bot_id = botId;
    if (!bot_id) {
      const bot = await getFirstBotForAdapter(httpOpts.baseUrl, token, adapterName);
      if (!bot) {
        logger.error(`未找到适配器 "${adapterName}" 下的 Bot，请使用 --bot <id> 指定`);
        process.exit(1);
      }
      bot_id = bot;
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
    } catch (e: unknown) {
      const err = e as Error;
      logger.error(err?.message || String(e));
      process.exit(1);
    }
  });
