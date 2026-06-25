/**
 * 将 icqq 守护进程 IPC 的 system.login.* 事件桥接到 core LoginAssist。
 *
 * 推送契约（@icqqjs/cli IpcEvent）：
 *   { id: "*", event: "system.login.auth", data: { url, device } }
 * 须在 endpoint.handleEvent 中按 event.event 先行处理（非 OneBot post_type）。
 *
 * 续传契约（LoginIpcActions ↔ LoginFlow）见 login-ipc-contract.ts。
 */
import type { LoginAssist, LoginAssistType } from '@zhin.js/core';
import type { IcqqEndpoint } from './endpoint.js';
import {
  LoginIpcActions,
  type IcqqLoginDeviceInfo,
} from './login-ipc-contract.js';

const activeByEndpoint = new Set<string>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveQrcodeImage(data: Record<string, unknown>): string | undefined {
  const image = data.image;
  if (image && typeof image === 'object') {
    const buf = image as { type?: string; data?: string };
    if (buf.type === 'Buffer' && typeof buf.data === 'string') {
      return `data:image/png;base64,${buf.data}`;
    }
  }
  if (typeof data.url === 'string' && data.url.startsWith('data:image')) {
    return data.url;
  }
  return undefined;
}

function mapLoginEvent(
  eventName: string,
  data: Record<string, unknown>,
): { type: LoginAssistType; payload: Record<string, unknown> } | null {
  switch (eventName) {
    case 'system.login.qrcode':
      return {
        type: 'qrcode',
        payload: {
          message: '请使用手机 QQ 扫码登录',
          image: resolveQrcodeImage(data),
        },
      };
    case 'system.login.slider':
      return {
        type: 'slider',
        payload: {
          message: '请完成滑块验证并提交 ticket',
          url: String(data.url ?? ''),
        },
      };
    case 'system.login.device':
      return {
        type: 'device',
        payload: {
          message: data.phone
            ? `请完成设备锁验证（密保手机 ${String(data.phone)}）`
            : '请完成设备锁验证',
          url: String(data.url ?? ''),
          phone: data.phone,
        },
      };
    case 'system.login.auth':
      return {
        type: 'auth',
        payload: {
          message: '请在浏览器完成身份验证（需使用下方设备信息）',
          url: String(data.url ?? ''),
          device: data.device as IcqqLoginDeviceInfo | undefined,
        },
      };
  }
  return null;
}

/** 对齐 @icqqjs/cli LoginFlow.handleSubmit → Client 方法 */
async function continueLoginAfterAssist(
  endpoint: IcqqEndpoint,
  loginType: LoginAssistType,
  value: string | Record<string, unknown>,
): Promise<void> {
  if (!endpoint.ipc || endpoint.ipc.closed) return;

  try {
    if (loginType === 'slider') {
      const ticket =
        typeof value === 'string'
          ? value.trim()
          : typeof value === 'object' && value !== null
            ? String((value as { ticket?: string }).ticket ?? '').trim()
            : '';
      if (!ticket) return;
      await endpoint.ipc.request(LoginIpcActions.SUBMIT_SLIDER, { ticket });
      return;
    }

    if (loginType === 'sms') {
      const code = typeof value === 'string' ? value.trim() : '';
      if (!code) return;
      await endpoint.ipc.request(LoginIpcActions.SUBMIT_SMS_CODE, { code });
      return;
    }

    if (loginType === 'device') {
      if (
        typeof value === 'object' &&
        value !== null &&
        (value as { action?: string }).action === 'sms'
      ) {
        await endpoint.ipc.request(LoginIpcActions.SEND_SMS_CODE, {});
        return;
      }
      if (typeof value === 'string' && value.trim()) {
        await endpoint.ipc.request(LoginIpcActions.SUBMIT_SMS_CODE, {
          code: value.trim(),
        });
        return;
      }
    }

    // qrcode / device 链接确认 / auth 237 确认 → client.login()
    await endpoint.ipc.request(LoginIpcActions.LOGIN, {});
  } catch (err) {
    endpoint.logger.warn(
      `登录辅助提交后 IPC 续传失败：${
        err instanceof Error ? err.message : String(err)
      }（action 须与 @icqqjs/cli action-catalog 一致）`,
    );
  }
}

export function handleIcqqLoginIpcEvent(
  endpoint: IcqqEndpoint,
  eventName: string,
  rawData: unknown,
): void {
  if (!eventName.startsWith('system.login.')) return;

  const root = endpoint.adapter.plugin.root;
  const loginAssist = root.inject('loginAssist') as LoginAssist | undefined;
  if (!loginAssist) {
    endpoint.logger.debug(`收到 ${eventName}，但 loginAssist 未启用`);
    return;
  }

  if (eventName === 'system.login.error') {
    const data = asRecord(rawData);
    endpoint.logger.warn(
      `icqq 登录错误：${String(data?.message ?? 'unknown')}${
        data?.code != null ? ` [code=${String(data.code)}]` : ''
      }`,
    );
    return;
  }

  const data = asRecord(rawData);
  if (!data) return;

  const mapped = mapLoginEvent(eventName, data);
  if (!mapped) return;

  const guardKey = endpoint.$id;
  if (activeByEndpoint.has(guardKey)) {
    endpoint.logger.debug(`跳过重复登录待办：${eventName}`);
    return;
  }
  activeByEndpoint.add(guardKey);

  endpoint.logger.info(`icqq 登录待办：${mapped.type}（${eventName}）`);

  void loginAssist
    .waitForInput('icqq', endpoint.$id, mapped.type, mapped.payload)
    .then((value) => continueLoginAfterAssist(endpoint, mapped.type, value))
    .catch((err) => {
      if (err instanceof Error && err.message !== 'cancelled') {
        endpoint.logger.warn(`登录辅助已取消或失败：${err.message}`);
      }
    })
    .finally(() => {
      activeByEndpoint.delete(guardKey);
    });
}

export function disposeIcqqLoginAssistBridge(endpointId: string): void {
  activeByEndpoint.delete(endpointId);
}

export type { IcqqLoginDeviceInfo } from './login-ipc-contract.js';
