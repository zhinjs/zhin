import type { PluginId, Token } from '@zhin.js/plugin-runtime';

/** Resources owned by one admitted execution, independent of reusable owner resources. */
export interface OperationResourceView {
  has(token: Token<unknown>): boolean;
  use<T>(token: Token<T>): T;
  close(): Promise<void>;
}
export interface CapabilityOperation {
  readonly signal: AbortSignal;
  readonly resources?: OperationResourceView;
}
/** Called only after the matched capability and its deterministic permissions are known. */
export interface CapabilityOperationFactory {
  readonly signal: AbortSignal;
  create(input: Readonly<{ owner: PluginId; signal: AbortSignal }>): CapabilityOperation;
}
