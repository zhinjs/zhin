/**
 * QQ 插件实例的运行时状态：adapter create() 注册的 endpoint 列表 +
 * 扫码绑定流程的全局单例。由 plugin.ts setup() provide，
 * adapter create 与 commands 通过 use(qqRuntimeStateToken) 共享（同一 owner generation）。
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

export interface QqRuntimeState {
  /** 当前 generation 已成功创建的 endpoint（name → 描述） */
  readonly endpoints: Map<string, QqRunningEndpoint>;
  /** 全局单例：同一时间只允许一个扫码绑定流程 */
  bindFlow: QqBindFlowHandle | null;
}

export function createQqRuntimeState(): QqRuntimeState {
  return {
    endpoints: new Map(),
    bindFlow: null,
  };
}

export const qqRuntimeStateToken = createToken<QqRuntimeState>(
  'zhin.qq.runtime-state',
  'QQ adapter runtime state (running endpoints + bind flow singleton)',
);
