import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';

/** @internal Author binding carried by an operation input, never by global state. */
export const operationInputBinding = Symbol.for('zhin.operation-input-binding/1');

/** @internal Retirement of the input's actual operation, independent of transport. */
export const operationInputSignal = Symbol.for('zhin.operation-input-signal/1');

export interface OperationInputLifetime {
  [operationInputSignal](): AbortSignal | undefined;
}

/** @internal Read the operation hook, never similarly named metadata fields. */
export function readOperationInputSignal(input: unknown): AbortSignal | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const read = (input as Partial<OperationInputLifetime>)[operationInputSignal];
  return typeof read === 'function' ? read.call(input) : undefined;
}

export interface OperationInputBinding {
  [operationInputBinding](owner: PluginId, snapshot: RuntimeSnapshot): unknown;
}

/** @internal Features remain neutral about the operation's message or transport. */
export function bindOperationInput<TInput>(input: TInput, owner: PluginId, snapshot: RuntimeSnapshot): TInput {
  if (!input || typeof input !== 'object') return input;
  const binding = (input as Partial<OperationInputBinding>)[operationInputBinding];
  return typeof binding === 'function' ? binding.call(input, owner, snapshot) as TInput : input;
}
