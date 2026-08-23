/**
 * Markdown Skill parsing and discovery contracts.
 * @module @zhin.js/skill
 */
/** @public Skill Markdown parsing contract. */
export * from './definition.js';
/** @internal Feature provider installed by the Runtime composition root. */
export * from './provider.js';
/** @internal Runtime Skill projection. */
export * from './skill-index.js';
export { default } from './provider.js';
