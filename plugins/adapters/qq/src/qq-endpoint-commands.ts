/**
 * `qq endpoint` 命令的业务逻辑（与命令定义文件分离，便于测试）。
 */
import { startQqBindFlow } from './qq-bind-flow.js';
import { persistQqCredentialsToEnv } from './qq-bind-persist.js';
import {
  addQqEndpointToConfig,
  listQqEndpointEntries,
  removeQqEndpointFromConfig,
} from './qq-endpoint-config.js';
import type { QqRuntimeState } from './qq-runtime-state.js';

export type QqCommandReply = (text: string) => Promise<unknown>;

/**
 * endpoint 管理命令的操作者校验：实例配置声明了 master（顶层或任一端点项）时
 * 仅 master 可执行 add/cancel/remove；未配置则放行（首个扫码绑定者即为 owner，
 * legacy applyBindOwnership 会把 operator 写为新端点的 master）。
 */
export function isQqEndpointOperator(config: unknown, input: unknown): boolean {
  const cfg = (config ?? {}) as { master?: unknown; endpoints?: unknown };
  const masters = new Set<string>();
  const collect = (value: unknown) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (text) masters.add(text);
  };
  collect(cfg.master);
  if (Array.isArray(cfg.endpoints)) {
    for (const entry of cfg.endpoints) {
      collect((entry as { master?: unknown } | null | undefined)?.master);
    }
  }
  if (masters.size === 0) return true;
  const sender = String((input as { sender?: unknown } | null | undefined)?.sender ?? '').trim();
  return !!sender && masters.has(sender);
}

export const QQ_ENDPOINT_FORBIDDEN = '仅 master 可执行 QQ endpoint 管理命令';

/**
 * 从命令 input（Runtime Message）提取 $reply；非消息来源（如 Host API 调用）降级为 no-op。
 */
export function extractQqCommandReply(input: unknown): QqCommandReply {
  const reply = (input as { $reply?: unknown } | null | undefined)?.$reply;
  if (typeof reply === 'function') {
    return (text) => (reply as (content: string) => Promise<unknown>).call(input, text);
  }
  return async () => undefined;
}

/** `qq endpoint list`：运行中的 endpoints（本 generation adapter create 注册）+ 配置里的 endpoints */
export function runQqEndpointList(state: QqRuntimeState, projectRoot?: string): string {
  const running = [...state.endpoints.values()];
  const configured = listQqEndpointEntries(projectRoot);
  const lines: string[] = [];
  lines.push('【运行中的 QQ endpoints】');
  if (running.length === 0) {
    lines.push('  （无）');
  } else {
    for (const endpoint of running) {
      lines.push(`  - ${endpoint.name}（${endpoint.mode}）`);
    }
  }
  lines.push('【配置中的 QQ endpoints】（zhin.config.yml → plugins.qq.endpoints）');
  if (configured.length === 0) {
    lines.push('  （无）');
  } else {
    for (const entry of configured) {
      lines.push(`  - ${entry.name}（appid: ${entry.appid}）`);
    }
  }
  if (state.bindFlow) {
    lines.push('⚠️ 有进行中的扫码绑定，可用 qq endpoint cancel 取消');
  }
  return lines.join('\n');
}

/**
 * `qq endpoint add [name]`：启动扫码绑定流程。
 * 返回的 Promise 在二维码链接就绪（或前置失败）时 resolve 为首条回复；
 * 后续状态（已扫码 / 成功 / 失败 / 过期刷新）通过 reply 推回当前会话。
 */
export function runQqEndpointAdd(
  state: QqRuntimeState,
  name: string | undefined,
  reply: QqCommandReply,
  projectRoot?: string,
): Promise<string> {
  if (state.bindFlow) {
    return Promise.resolve('已有进行中的 QQ 机器人绑定，请先发送 qq endpoint cancel 取消后再试');
  }
  const endpointName = name?.trim() || undefined;
  return new Promise<string>((resolve) => {
    let firstReplied = false;
    const settle = (text: string) => {
      if (!firstReplied) {
        firstReplied = true;
        resolve(text);
        return;
      }
      void reply(text);
    };
    const stop = startQqBindFlow(
      {
        onQrDisplayed: (url) => {
          // QQ 出站当前仅支持纯文本（富媒体未迁移），二维码只能发链接文本
          settle(
            `请用手机 QQ 打开以下链接完成扫码绑定（二维码图片出站暂未支持，故发送链接）：\n${url}`,
          );
        },
        onQrExpired: async () => {
          await reply('二维码已过期，正在刷新，请扫描新链接…');
        },
        onSuccess: async (credentials) => {
          state.bindFlow = null;
          try {
            const [{ appId, appSecret }] = credentials;
            const finalName = endpointName ?? appId;
            const envKeys = persistQqCredentialsToEnv(finalName, appId, appSecret, projectRoot);
            const filePath = addQqEndpointToConfig(
              { name: finalName, appid: envKeys.appidRef, secret: envKeys.secretRef },
              projectRoot,
            );
            settle(
              `✅ 绑定成功！endpoint「${finalName}」的凭据已写入 .env，并已追加到 ${filePath} 的 plugins.qq.endpoints。\n` +
              '⚠️ 需重启 zhin 后新 endpoint 才会生效。',
            );
          } catch (error) {
            settle(`绑定成功但写入配置失败：${error instanceof Error ? error.message : String(error)}`);
          }
        },
        onFailure: (error) => {
          state.bindFlow = null;
          settle(`❌ QQ 绑定失败：${error.message}`);
        },
      },
      { source: 'zhin' },
    );
    state.bindFlow = { name: endpointName, stop };
  });
}

/** `qq endpoint cancel`：中止进行中的绑定流程 */
export function runQqEndpointCancel(state: QqRuntimeState): string {
  if (!state.bindFlow) {
    return '当前没有进行中的 QQ 绑定流程';
  }
  state.bindFlow.stop();
  state.bindFlow = null;
  return '已取消进行中的 QQ 绑定流程';
}

/** `qq endpoint remove <name>`：从 zhin.config.yml 移除对应 endpoints 项 */
export function runQqEndpointRemove(
  _state: QqRuntimeState,
  name: string,
  projectRoot?: string,
): string {
  const trimmed = name.trim();
  if (!trimmed) return '用法：qq endpoint remove <name>';
  try {
    const { removed, filePath } = removeQqEndpointFromConfig(trimmed, projectRoot);
    if (!removed) {
      return `配置中不存在 qq endpoint「${trimmed}」（${filePath} → plugins.qq.endpoints）`;
    }
    return (
      `已从 ${filePath} 的 plugins.qq.endpoints 移除「${trimmed}」。\n` +
      '⚠️ 需重启 zhin 后生效（运行中的连接届时才会断开）；.env 中的凭据键未删除，可手动清理。'
    );
  } catch (error) {
    return `移除失败：${error instanceof Error ? error.message : String(error)}`;
  }
}
