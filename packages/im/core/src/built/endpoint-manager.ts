import type { Schema } from '@zhin.js/schema';
import type { Message } from '../message.js';
import type { Plugin } from '../plugin.js';
import type { SendContent } from '../types.js';

/** zhin.config.endpoints[] 单条记录 */
export type EndpointConfigRecord = Record<string, unknown> & {
  context: string;
  name: string;
};

export type EndpointStatusExtra = Record<string, unknown>;

export interface ProvisionContext {
  message: Message;
  root: Plugin;
  /** 长连接 / 扫码 / 登录进度回调（由 core 转发到 message.$reply） */
  onStatusUpdate: (status: string, extra?: EndpointStatusExtra) => void | Promise<void>;
}

export interface EndpointManager {
  /** 是否支持运行时 add（含 schema 通用或自定义） */
  supportsProvision(): boolean;
  listEndpoints(): EndpointConfigRecord[];
  addEndpoint(ctx: ProvisionContext): Promise<EndpointConfigRecord>;
  editEndpoint(name: string, ctx: ProvisionContext): Promise<EndpointConfigRecord>;
  removeEndpoint(name: string): Promise<boolean>;
  startEndpoint(name: string, ctx: ProvisionContext): Promise<void>;
  stopEndpoint(name: string): Promise<boolean>;
  /** 取消进行中的 add/edit 交互（如 QQ 扫码）；无则返回 false */
  cancelProvision?(): boolean;
}

export interface EndpointManagerClass {
  new (adapter: import('../adapter.js').Adapter): EndpointManager;
  /** 热连接失败时是否建议重启进程 */
  readonly needsRestart?: boolean;
  /** 通用 schema 驱动 add/edit 时使用 */
  readonly endpointConfigSchema?: Schema;
}
