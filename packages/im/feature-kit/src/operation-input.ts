import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';

/** @internal Author binding carried by an operation input, never by global state. */
export const operationInputBinding = Symbol.for('zhin.operation-input-binding/1');

export interface OperationInputBinding {
  [operationInputBinding](owner: PluginId, snapshot: RuntimeSnapshot): unknown;
}

/** @internal Features remain neutral about the operation's message or transport. */
export function bindOperationInput<TInput>(input: TInput, owner: PluginId, snapshot: RuntimeSnapshot): TInput {
  if (!input || typeof input !== 'object') return input;
  const binding = (input as Partial<OperationInputBinding>)[operationInputBinding];
  return typeof binding === 'function' ? binding.call(input, owner, snapshot) as TInput : input;
}
