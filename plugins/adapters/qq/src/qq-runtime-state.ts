/**
 * QQ 插件实例的运行时状态：adapter create() 注册的 endpoint 列表 +
 * 扫码绑定 / 待选 botKind 流程。由 plugin.ts setup() provide，
 * adapter create 与 commands / middleware 通过 use(qqRuntimeStateToken) 共享。
 */
import { createToken } from '@zhin.js/plugin-runtime';

export interface QqRunningEndpoint {
  name: string;
  mode: string;
}

export interface QqBindFlowHandle {
  /** 绑定期望的 endpoint 名（未指定时为 undefined，成功后取 appId） */
  name?: string;
  stop: () => void;
}

/**
 * 扫码成功后暂存在内存：确认公域/私域后再一次性写 .env + yaml。
 * （提前写 .env 会触发 HMR，冲掉 pending。）
 */
export interface QqPendingBotKind {
  readonly endpointName: string;
  readonly appId: string;
  readonly appSecret: string;
  /** 发起 add 的会话键；仅同会话回复可完成选择 */
  readonly sessionKey: string;
}

export interface QqRuntimeState {
  /** 当前 generation 已成功创建的 endpoint（name → 描述） */
  readonly endpoints: Map<string, QqRunningEndpoint>;
  /** 全局单例：同一时间只允许一个扫码绑定流程 */
  bindFlow: QqBindFlowHandle | null;
  /** 扫码完成后等待 botKind 选择（凭据仅在内存） */
  pendingBotKind: QqPendingBotKind | null;
}

export function createQqRuntimeState(): QqRuntimeState {
  return {
    endpoints: new Map(),
    bindFlow: null,
    pendingBotKind: null,
  };
}

export const qqRuntimeStateToken = createToken<QqRuntimeState>(
  'zhin.qq.runtime-state',
  'QQ adapter runtime state (running endpoints + bind flow singleton)',
);
