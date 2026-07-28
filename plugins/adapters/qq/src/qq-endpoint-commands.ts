/**
 * `qq endpoint` 命令的业务逻辑（与命令定义文件分离，便于测试）。
 * 通用部分（权限 / list / remove / 配置写回 / .env 持久化）已迁移到
 * @zhin.js/adapter 的 createEndpointCommands 套件；本文件保留 QQ 特化的
 * 扫码绑定 add 流程（经套件 bindFlow 钩子接入）与 cancel，并导出
 * qqEndpointCommands 供 commands/endpoint/ 下的命令文件默认导出。
 */
import {
  createEndpointCommands,
  endpointCommandForbidden,
  extractEndpointCommandReply,
  formatEndpointList,
  isEndpointOperator,
  removeEndpointByName,
  type ConfiguredEndpointEntry,
  type EndpointCommandReply,
} from '@zhin.js/adapter';
import { defineCommand } from '@zhin.js/command';
import { startQqBindFlow } from './qq-bind-flow.js';
import { persistQqCredentialsToEnv } from './qq-bind-persist.js';
import { addQqEndpointToConfig, listQqEndpointEntries } from './qq-endpoint-config.js';
import { qqRuntimeStateToken, type QqRuntimeState } from './qq-runtime-state.js';

export type QqCommandReply = EndpointCommandReply;

/**
 * endpoint 管理命令的操作者校验：实例配置声明了 master（顶层或任一端点项）时
 * 仅 master 可执行 add/cancel/remove；未配置则放行（首个扫码绑定者即为 owner，
 * legacy applyBindOwnership 会把 operator 写为新端点的 master）。
 */
export function isQqEndpointOperator(config: unknown, input: unknown): boolean {
  return isEndpointOperator(config, input);
}

export const QQ_ENDPOINT_FORBIDDEN = endpointCommandForbidden('QQ');

/**
 * 从命令 input（Runtime Message）提取 $reply；非消息来源（如 Host API 调用）降级为 no-op。
 */
export function extractQqCommandReply(input: unknown): QqCommandReply {
  return extractEndpointCommandReply(input);
}

/** `qq endpoint list`：运行中的 endpoints（本 generation adapter create 注册）+ 配置里的 endpoints */
export function runQqEndpointList(state: QqRuntimeState, projectRoot?: string): string {
  return formatEndpointList(qqEndpointListSpec, {
    running: state.endpoints.values(),
    configured: listQqEndpointEntries(projectRoot),
    footer: state.bindFlow ? '⚠️ 有进行中的扫码绑定，可用 qq endpoint cancel 取消' : undefined,
  });
}

const qqEndpointListSpec = {
  adapterKey: 'qq',
  adapterDisplayName: 'QQ',
  describeEntry: (entry: ConfiguredEndpointEntry) => `appid: ${String(entry.appid)}`,
} as const;

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
  return removeEndpointByName(qqEndpointListSpec, name, projectRoot);
}

/**
 * 通用套件生成的 QQ endpoint 命令（add 经 bindFlow 钩子走扫码绑定）。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项；cancel 为 QQ 特化，单独定义。
 */
export const qqEndpointCommands = createEndpointCommands({
  ...qqEndpointListSpec,
  fields: [
    { key: 'appid', required: true, env: true, description: 'QQ 机器人 appid' },
    { key: 'secret', required: true, env: true, description: 'QQ 机器人 secret' },
  ],
  running: (use) => use(qqRuntimeStateToken).endpoints.values(),
  listFooter: (use) => {
    const state = use(qqRuntimeStateToken);
    return state.bindFlow ? '⚠️ 有进行中的扫码绑定，可用 qq endpoint cancel 取消' : undefined;
  },
  addDescription: '手机 QQ 扫码绑定机器人，凭据写入 .env 并追加到 zhin.config.yml（重启生效）',
  bindFlow: ({ name, reply, use }) => runQqEndpointAdd(use(qqRuntimeStateToken), name, reply),
}, defineCommand);
