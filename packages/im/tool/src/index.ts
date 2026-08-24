/**
 * Agent Tool definitions and invocation policy contracts.
 * @module @zhin.js/tool
 */
/** @public Agent Tool authoring contract and `defineAgentTool`. */
export * from './definition.js';
export {
  readOperationClient,
  type AdapterClient,
  type RegisteredAdapterName,
} from '@zhin.js/feature-kit';
/** @internal Feature provider installed by the Runtime composition root. */
export * from './provider.js';
/** @internal Runtime Tool projection. */
export * from './tool-index.js';
export { default } from './provider.js';
