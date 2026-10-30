/**
 * QQ Console 扫码绑定：把原本只能在聊天里执行的 `qq endpoint add` 流程
 * 搬到 Console 页面。
 *
 * - `start` 返回扫码链接；后续状态写入 `state.consoleBind`，页面轮询 status。
 * - 扫码成功后凭据只留在内存，等页面选择公域 / 私域再一次性写 `.env` + 配置。
 * - 与聊天命令共享 `state.bindFlow` 单例，同一时间只允许一个绑定流程。
 */
import { PluginConsoleRpcError } from 'zhin.js';
import { startQqBindFlow } from './qq-bind-flow.js';
import { writeQqEndpointWithBotKind, type QqEndpointWriteResult } from './qq-endpoint-write.js';
import { parseQqBotKind } from './qq-intents.js';
import type { QqRuntimeState } from './qq-runtime-state.js';
import type { EndpointConfigurationStore } from 'zhin.js/adapter';

/** 启动 Console 扫码；resolve 时二维码链接已就绪。 */
export function startQqConsoleBind(
  state: QqRuntimeState,
  id?: string,
): Promise<{ readonly url: string }> {
  if (state.bindFlow || state.pendingBotKind) {
    throw new PluginConsoleRpcError('conflict', '已有扫码绑定流程在进行，请先完成或取消');
  }
  if (state.consoleBind?.pending) {
    throw new PluginConsoleRpcError('conflict', '已经扫码成功，请先选择公域或私域');
  }
  const endpointId = id?.trim() || undefined;
  return new Promise((resolve, reject) => {
    let settled = false;
    const stop = startQqBindFlow({
      onQrDisplayed: (url) => {
        state.consoleBind = {
          state: 'waiting',
          url,
          message: '请用手机 QQ 扫码',
          startedAt: state.consoleBind?.startedAt ?? Date.now(),
        };
        if (settled) return;
        settled = true;
        resolve({ url });
      },
      onQrExpired: () => {
        state.consoleBind = {
          state: 'waiting',
          ...(state.consoleBind?.url ? { url: state.consoleBind.url } : {}),
          message: '二维码已过期，正在刷新…',
          startedAt: state.consoleBind?.startedAt ?? Date.now(),
        };
      },
      onSuccess: (credentials) => {
        state.bindFlow = null;
        const [first] = credentials;
        if (!first) {
          state.consoleBind = {
            state: 'failed',
            error: '扫码结果为空，请重新扫码',
            startedAt: state.consoleBind?.startedAt ?? Date.now(),
          };
          return;
        }
        state.consoleBind = {
          state: 'scanned',
          ...(state.consoleBind?.url ? { url: state.consoleBind.url } : {}),
          message: '已扫码，请选择公域或私域',
          startedAt: state.consoleBind?.startedAt ?? Date.now(),
          pending: {
            endpointId: endpointId ?? first.appId,
            appId: first.appId,
            appSecret: first.appSecret,
          },
        };
      },
      onFailure: (error) => {
        state.bindFlow = null;
        state.consoleBind = {
          state: 'failed',
          error: error.message,
          startedAt: state.consoleBind?.startedAt ?? Date.now(),
        };
        if (settled) return;
        settled = true;
        reject(new PluginConsoleRpcError('unavailable', error.message));
      },
    }, { source: 'zhin' });
    state.bindFlow = { id: endpointId, stop, locale: 'zh-CN' };
  });
}

/** 扫码成功后选择公域 / 私域并写回配置。 */
export async function completeQqConsoleBind(
  state: QqRuntimeState,
  store: EndpointConfigurationStore,
  kindValue: unknown,
): Promise<QqEndpointWriteResult> {
  const pending = state.consoleBind?.pending;
  if (!pending) {
    throw new PluginConsoleRpcError('conflict', '还没有扫码成功，请先扫码绑定');
  }
  const botKind = parseQqBotKind(kindValue);
  if (!botKind) {
    throw new PluginConsoleRpcError('invalid_input', '请选择公域（public）或私域（private）');
  }
  try {
    const result = await writeQqEndpointWithBotKind({ ...pending, botKind }, store);
    state.consoleBind = null;
    return result;
  } catch {
    throw new PluginConsoleRpcError('unavailable', '写入配置失败，请检查配置文件和 .env 的权限');
  }
}

/** 取消 Console 绑定（也可用于收拾聊天命令发起的流程）。 */
export function cancelQqConsoleBind(state: QqRuntimeState): boolean {
  const active = Boolean(state.bindFlow || state.pendingBotKind || state.consoleBind);
  try {
    state.bindFlow?.stop();
  } catch {
    // best effort
  }
  state.bindFlow = null;
  state.pendingBotKind = null;
  state.consoleBind = null;
  return active;
}
