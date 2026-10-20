/**
 * Renderable component authoring contracts.
 * @module @zhin.js/component
 */
/** @internal Runtime component projection. */
export * from './component-index.js';
/** @public Component authoring contract and `defineComponent`. */
export * from './definition.js';
/** @internal Feature provider installed by the Runtime composition root. */
export * from './provider.js';
export { default } from './provider.js';
