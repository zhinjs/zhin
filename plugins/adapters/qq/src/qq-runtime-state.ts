/**
 * QQ 插件实例的瞬态扫码绑定 / 待选 botKind 流程。
 * 账号目录与 SDK 生命周期只由所属 Adapter 持有；此处不保存 Endpoint Map。
 */
import { createToken } from 'zhin.js';
import type { QqEndpointSavePort } from './qq-endpoint-write.js';

export interface QqBindFlowHandle {
  /** 绑定期望的 endpoint id（未指定时为 undefined，成功后取 appId） */
  id?: string;
  stop: () => void;
  readonly locale?: import('zhin.js/i18n').Locale;
  readonly cancelCommand?: string;
  readonly commandHeads?: readonly string[];
}

/**
 * 扫码成功后暂存在内存：确认公域/私域后调用发起时捕获的所属 Adapter CAS。
 */
export interface QqPendingBotKind {
  readonly save: QqEndpointSavePort;
  readonly endpointId: string;
  readonly appId: string;
  readonly appSecret: string;
  /** 发起 add 的会话键；仅同会话回复可完成选择 */
  readonly sessionKey: string;
  readonly locale?: import('zhin.js/i18n').Locale;
  readonly cancelCommand?: string;
  readonly commandHeads?: readonly string[];
}

/**
 * Console 发起的扫码绑定进度。凭据（appSecret）只留在内存，
 * status 只暴露状态、扫码链接与目标 endpoint id。
 */
export interface QqConsoleBindState {
  readonly state: 'waiting' | 'scanned' | 'failed';
  readonly url?: string;
  readonly message?: string;
  readonly error?: string;
  readonly startedAt: number;
  /** 扫码成功后暂存，确认公域/私域后写配置。 */
  readonly pending?: {
    readonly endpointId: string;
    readonly appId: string;
    readonly appSecret: string;
  };
}

export interface QqRuntimeState {
  /** Snapshot checked when the QR flow began, never a second account directory. */
  consoleAdmission: Readonly<{ adapterId: string; generation: number; revision: number | null }> | null;
  /** 同一插件 generation 内只允许一个扫码绑定流程 */
  bindFlow: QqBindFlowHandle | null;
  /** 扫码完成后等待 botKind 选择（凭据仅在内存） */
  pendingBotKind: QqPendingBotKind | null;
  /** Console 页面的扫码绑定进度（与 bindFlow 共享同一插件瞬态流程）。 */
  consoleBind: QqConsoleBindState | null;
}

export function createQqRuntimeState(): QqRuntimeState {
  return {
    consoleAdmission: null,
    bindFlow: null,
    pendingBotKind: null,
    consoleBind: null,
  };
}

export const qqRuntimeStateToken = createToken<QqRuntimeState>(
  'zhin.qq.runtime-state',
  'QQ transient QR binding state',
);
