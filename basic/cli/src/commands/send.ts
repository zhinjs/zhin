/**
 * send — 在 daemon 运行时向指定平台发送消息
 *
 * 调用运行中实例的 `POST {base}/message/send`（Host 经出站链投递）。
 * 默认 --scene private；适配器未指定时仅当实例只有一个适配器才自动选用。
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { reportHostFailure } from '../utils/host-error.js';
import {
  hostPost,
  listHostEndpoints,
  HOST_OPTION_DESCRIPTION,
  requireHostHttpConfig,
  type HostEndpointRow,
} from '../utils/host-http.js';

export type SendTarget =
  | { readonly ok: true; readonly adapter: string; readonly endpoint: string }
  | { readonly ok: false; readonly error: string };

/** Picks the adapter/endpoint pair for `zhin send` from the running Host's endpoint list. */
export function resolveSendTarget(
  endpoints: readonly HostEndpointRow[],
  adapter?: string,
  endpoint?: string,
): SendTarget {
  let adapterName = adapter;
  if (!adapterName) {
    const candidates = endpoint ? endpoints.filter((row) => row.name === endpoint) : endpoints;
    const adapters = [...new Set(candidates.map((row) => row.adapter))];
    if (adapters.length === 0) {
      return { ok: false, error: endpoint ? `未找到 Endpoint "${endpoint}"` : '运行中的实例没有任何 Endpoint' };
    }
    if (adapters.length > 1) {
      return { ok: false, error: `存在多个适配器（${adapters.join('、')}），请使用 --adapter <name> 指定` };
    }
    adapterName = adapters[0]!;
  }
  if (endpoint) return { ok: true, adapter: adapterName, endpoint };
  const rows = endpoints.filter((row) => row.adapter === adapterName);
  const picked = rows.find((row) => row.status === 'online') ?? rows[0];
  if (!picked) {
    return { ok: false, error: `未找到适配器 "${adapterName}" 下的 Endpoint，请使用 --endpoint <id> 指定` };
  }
  return { ok: true, adapter: adapterName, endpoint: picked.name };
}

export const sendCommand = new Command('send')
  .description('向 daemon 运行中的机器人指定场景发送消息（需启用 HTTP 服务）')
  .argument('<scene_id>', '场景 ID（私聊为用户 ID，群聊为群号等）')
  .argument('[content...]', '消息内容（可多词，用空格连接）；不传则从 stdin 读取一行')
  .option('-s, --scene <type>', '场景类型：private | group | channel', 'private')
  .option('-a, --adapter <name>', '适配器名称（icqq、discord 等）；实例只有一个适配器时可省略')
  .option('-e, --endpoint <id>', '指定 Endpoint ID，不传则使用该适配器下第一个在线 Endpoint')
  .option('--host <url>', HOST_OPTION_DESCRIPTION)
  .action(async (sceneId: string, contentParts: string[]) => {
    const opts = sendCommand.opts();
    const sceneType = (opts.scene as string) || 'private';
    const adapterOption = opts.adapter as string | undefined;
    const endpointKey = opts.endpoint as string | undefined;
    if (!['private', 'group', 'channel'].includes(sceneType)) {
      logger.error('--scene 必须是 private | group | channel');
      process.exit(1);
    }

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

    const http = await requireHostHttpConfig({ host: opts.host as string | undefined }, message => logger.error(message));

    let adapter = adapterOption;
    let endpoint = endpointKey;
    if (!adapter || !endpoint) {
      const listed = await listHostEndpoints(http);
      if (!listed.ok) {
        logger.error(listed.error ?? `HTTP ${listed.status}`);
        process.exit(1);
      }
      const target = resolveSendTarget(listed.data ?? [], adapterOption, endpointKey);
      if (!target.ok) {
        logger.error(target.error);
        process.exit(1);
      }
      adapter = target.adapter;
      endpoint = target.endpoint;
    }

    const res = await hostPost<{ messageId?: string }>(http, '/message/send', {
      adapter,
      endpoint,
      id: sceneId,
      type: sceneType,
      content,
    });
    if (!res.ok) {
      await reportHostFailure(res, '发送失败');
      process.exit(1);
    }
    console.log(chalk.green('已发送'));
    if (res.data?.messageId) {
      console.log(chalk.gray('  messageId: ' + res.data.messageId));
    }
  });
