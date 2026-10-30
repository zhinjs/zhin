import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from '../../../src/i18n.js';
/**
 * `qq endpoint` 命令的业务逻辑（与命令定义文件分离，便于测试）。
 * 通用部分（权限 / list / remove / 配置写回 / .env 持久化）已迁移到
 * @zhin.js/adapter 的 createEndpointCommands 套件；本文件保留 QQ 特化的
 * 扫码绑定 add 流程（经套件 bindFlow 钩子接入）与 cancel，并导出
 * qqEndpointCommands 供 commands/qq/endpoint/ 下的命令文件默认导出。
 */
import {
  createEndpointCommands,
  endpointCommandForbidden,
  endpointConfigurationStoreToken,
  extractEndpointCommandReply,
  formatEndpointList,
  isEndpointOperator,
  removeEndpointById,
  type ConfiguredEndpointEntry,
  type EndpointCommandReply,
  type EndpointConfigurationStore,
} from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { qqBotKindPrompt, qqCommandSessionKey } from '../../../src/qq-bot-kind-prompt.js';
import { startQqBindFlow } from '../../../src/qq-bind-flow.js';
import { writeQqEndpointWithBotKind } from '../../../src/qq-endpoint-write.js';
import type { QqBotKind } from '../../../src/qq-intents.js';
import { cancelQqConsoleBind } from '../../../src/qq-console.js';
import {
  qqRuntimeStateToken,
  type QqPendingBotKind,
  type QqRuntimeState,
} from '../../../src/qq-runtime-state.js';

export { qqRuntimeStateToken };

export type QqCommandReply = EndpointCommandReply;

/**
 * endpoint 管理命令的操作者校验：实例配置声明了 master（顶层或任一端点项）时
 * 仅 master 可执行 add/cancel/remove；未配置则放行（首个扫码绑定者即为 owner，
 * legacy applyBindOwnership 会把 operator 写为新端点的 master）。
 */
export function isQqEndpointOperator(config: unknown, input: unknown): boolean {
  if (isEndpointOperator(config, input)) return true;
  // The outage-notify target is the operator's conversation on another adapter.
  const cfg = (config ?? {}) as {
    notify?: { id?: unknown };
    endpoints?: readonly { notify?: { id?: unknown } }[];
  };
  const notifyIds = [
    cfg.notify?.id,
    ...(Array.isArray(cfg.endpoints) ? cfg.endpoints.map((endpoint) => endpoint.notify?.id) : []),
  ];
  const senderRaw = (input as { sender?: { id?: unknown } } | null | undefined)?.sender;
  const senderId = (typeof senderRaw === 'object' && senderRaw?.id) ? String(senderRaw.id).trim() : '';
  return senderId !== '' && notifyIds.some((id) => id != null && String(id) === senderId);
}

export const QQ_ENDPOINT_FORBIDDEN = endpointCommandForbidden('QQ');

/**
 * 从命令 input（Runtime Message）提取 $reply；非消息来源（如 Host API 调用）降级为 no-op。
 */
export function extractQqCommandReply(input: unknown): QqCommandReply {
  return extractEndpointCommandReply(input);
}

function busyFooter(state: QqRuntimeState, locale?: Locale): string | undefined {
  if (state.bindFlow) return t(locale, 'bindingBusy') + (state.bindFlow.cancelCommand ? `\n${t(locale, 'cancelHint', { command: state.bindFlow.cancelCommand })}` : '');
  if (state.pendingBotKind) {
    return t(locale, 'kindBusy', { id: state.pendingBotKind.endpointId });
  }
  if (state.consoleBind?.state === 'scanned') {
    return t(locale, 'kindBusy', { id: state.consoleBind.pending?.endpointId ?? 'QQ' });
  }
  return undefined;
}

/** `qq endpoint list`：运行中的 endpoints（本 generation adapter create 注册）+ 配置里的 endpoints */
export async function runQqEndpointList(
  state: QqRuntimeState,
  store: EndpointConfigurationStore,
  locale?: Locale,
): Promise<string> {
  return formatEndpointList(qqEndpointListSpec, {
    running: state.endpoints.values(),
    configured: await store.list('qq'),
    footer: busyFooter(state, locale), locale,
  });
}

const qqEndpointListSpec = {
  adapterKey: 'qq',
  adapterDisplayName: 'QQ',
  describeEntry: (entry: ConfiguredEndpointEntry) => `appid: ${String(entry.appid)}`,
} as const;

async function writeEndpointWithBotKind(
  pending: QqPendingBotKind,
  botKind: QqBotKind,
  store: EndpointConfigurationStore,
): Promise<string> {
  const result = await writeQqEndpointWithBotKind({
    endpointId: pending.endpointId,
    appId: pending.appId,
    appSecret: pending.appSecret,
    botKind,
  }, store);
  return t(pending.locale, 'endpointSaved', {
    kind: result.botKind,
    id: result.endpointId,
    file: result.filePath,
    intents: result.intents.join(', '),
  });
}

/**
 * 完成 pending 的公域/私域选择：一次性写 .env + yaml。
 * @returns 成功文案；调用方负责清 pending。
 */
export async function completeQqPendingBotKind(
  pending: QqPendingBotKind,
  botKind: QqBotKind,
  store: EndpointConfigurationStore,
): Promise<string> {
  return await writeEndpointWithBotKind(pending, botKind, store);
}

/**
 * `qq endpoint add [id]`：启动扫码绑定流程。
 * 返回的 Promise 在二维码链接就绪（或前置失败）时 resolve 为首条回复；
 * 后续状态（已扫码 / 成功 / 失败 / 过期刷新）通过 reply 推回当前会话。
 * 扫码成功后凭据暂存内存并询问公域/私域；确认后一次性写 .env + yaml。
 */
export function runQqEndpointAdd(
  state: QqRuntimeState,
  id: string | undefined,
  reply: QqCommandReply,
  store: EndpointConfigurationStore,
  input?: unknown,
  locale: Locale = 'zh-CN',
  cancelCommand?: string,
  commandHeads?: readonly string[],
): Promise<string> {
  if (state.bindFlow || state.pendingBotKind || state.consoleBind?.pending || state.consoleBind?.state === 'waiting') {
    return Promise.resolve(
      t(locale, 'existingFlow'),
    );
  }
  state.consoleBind = null;
  const endpointId = id?.trim() || undefined;
  const sessionKey = qqCommandSessionKey(input);
  return new Promise<string>((resolve) => {
    let firstReplied = false;
    const settle = (text: string) => {
      if (!firstReplied) {
        firstReplied = true;
        resolve(text);
        return;
      }
      // Follow-ups outlive the inbound Message reply scope; durable reply
      // (OutboundHost) is provided by createEndpointCommands.bindFlow. Never
      // let a late notify crash the process.
      void Promise.resolve(reply(text)).catch(() => undefined);
    };
    const stop = startQqBindFlow(
      {
        onQrDisplayed: (url) => {
          // QQ 出站当前仅支持纯文本（富媒体未迁移），二维码只能发链接文本
          settle(
            t(locale, 'scanLink', { url }),
          );
        },
        onQrExpired: async () => {
          try {
            await reply(t(locale, 'qrExpired'));
          } catch {
            // same as settle follow-up: best-effort after command scope ends
          }
        },
        onSuccess: async (credentials) => {
          state.bindFlow = null;
          try {
            const [{ appId, appSecret }] = credentials;
            const finalName = endpointId ?? appId;

            // 无会话上下文（Host 等）时无法追问，直接按公域一次性写入
            if (!sessionKey) {
              settle(
                await writeEndpointWithBotKind(
                  {
                    endpointId: finalName,
                    appId,
                    appSecret,
                    sessionKey: '', locale, cancelCommand,
                  },
                  'public',
                  store,
                ) +
                t(locale, 'noInteractiveKind'),
              );
              return;
            }

            state.pendingBotKind = {
              endpointId: finalName,
              appId,
              appSecret,
              sessionKey, locale, cancelCommand, commandHeads,
            };
            settle(
              t(locale, 'scanned', { id: finalName, prompt: qqBotKindPrompt(locale, cancelCommand) }),
            );
          } catch (error) {
            settle(t(locale, 'writeFailed', { error: error instanceof Error ? error.message : String(error) }));
          }
        },
        onFailure: (error) => {
          state.bindFlow = null;
          settle(t(locale, 'bindingFailed', { error: error.message }));
        },
      },
      { source: 'zhin', locale },
    );
    state.bindFlow = { id: endpointId, stop, locale, cancelCommand, commandHeads };
  });
}

/** `qq endpoint cancel`：中止进行中的绑定或待选 botKind */
export function runQqEndpointCancel(state: QqRuntimeState, preference?: Locale): string {
  const locale = resolveLocale(state.pendingBotKind?.locale ?? state.bindFlow?.locale ?? preference);
  if (state.bindFlow) {
    state.bindFlow.stop();
    state.bindFlow = null;
    cancelQqConsoleBind(state);
    return t(locale, 'cancelled');
  }
  if (state.pendingBotKind) {
    const name = state.pendingBotKind.endpointId;
    state.pendingBotKind = null;
    return t(locale, 'pendingCancelled', { name });
  }
  if (state.consoleBind) {
    cancelQqConsoleBind(state);
    return t(locale, 'cancelled');
  }
  return t(locale, 'noFlow');
}

/** `qq endpoint remove <id>`：从 zhin.config.yml 移除对应 endpoints 项 */
export async function runQqEndpointRemove(
  _state: QqRuntimeState,
  id: string,
  store: EndpointConfigurationStore,
): Promise<string> {
  return await removeEndpointById(qqEndpointListSpec, id, store);
}

/**
 * 通用套件生成的 QQ endpoint 命令（add 经 bindFlow 钩子走扫码绑定）。
 * commands/qq/endpoint/ 下的 list / add / remove 直接默认导出这三项；cancel 为 QQ 特化，单独定义。
 */
export const qqEndpointCommands = createEndpointCommands({
  ...qqEndpointListSpec,
  fields: [
    { key: 'appid', required: true, env: true, description: 'QQ 机器人 appid', descriptionI18n: { en: "QQ bot app ID" } },
    { key: 'secret', required: true, env: true, description: 'QQ 机器人 secret', descriptionI18n: { en: "QQ bot secret" } },
  ],
  running: (use) => use(qqRuntimeStateToken).endpoints.values(),
  listFooter: (use, locale) => busyFooter(use(qqRuntimeStateToken), locale),
  addDescriptionI18n: { en: 'Bind a bot through mobile QQ, choose public/private, then save configuration; restart to apply' },
  addDescription:
    '手机 QQ 扫码绑定机器人：确认公域/私域后一次性写入 .env 与 zhin.config.yml（重启生效）',
  bindFlow: ({ id, reply, input, use, locale, formatCommand }) =>
    runQqEndpointAdd(
      use(qqRuntimeStateToken),
      id,
      reply,
      use(endpointConfigurationStoreToken),
      input, locale, formatCommand?.('qq endpoint cancel'),
      ['qq endpoint list', 'qq endpoint add', 'qq endpoint remove', 'qq endpoint cancel'].flatMap(path => { const head = formatCommand?.(path); return head ? [head] : []; }),
    ),
}, defineCommand);
