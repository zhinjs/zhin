/**
 * Typed lifecycle event handler authoring contracts.
 * @module @zhin.js/handler
 */
/** @public Handler authoring contract and `defineHandler`. */
export * from './definition.js';
/** @public Handler execution context available as the callback `this` value. */
export * from './context.js';
/** @internal Runtime handler projection. */
export * from './handler-index.js';
/** @internal Feature provider installed by the Runtime composition root. */
export * from './provider.js';
export { default } from './provider.js';
