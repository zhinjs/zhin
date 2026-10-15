/**
 * Workroom data governance / payload vault / payload lifecycle authority.
 *
 * FROZEN: moved out of the package root entry (C4c). The default (legacy Kernel)
 * assembly path in `@zhin.js/cli` still creates these modules; they are only
 * not part of the root exports. The new Room core does not depend on them.
 * New code must not depend on it.
 */
export * from './data-governance/data-governance.js';
export * from './data-governance/disclosure-manifest.js';
export * from './data-governance/database-payload-lifecycle-repository.js';
export * from './data-governance/encrypted-database-payload-vault.js';
export * from './data-governance/payload-vault-storage-handoff.js';
export * from './data-governance/payload-hold-overdue-projection.js';
export * from './data-governance/disclosure-authority.js';
export * from './workroom-runtime/workroom-data-governance-authority-writer.js';
export * from './workroom-runtime/workroom-data-governance-bootstrap.js';
export * from './workroom-runtime/workroom-data-governance-composition.js';
export * from './workroom-runtime/workroom-data-governance-root-provider.js';
export * from './workroom-runtime/workroom-data-governance-runtime.js';
export * from './workroom-runtime/workroom-data-governance-storage.js';
export * from './workroom-runtime/workroom-data-lifecycle-composition.js';
export * from './workroom-runtime/workroom-data-lifecycle-console.js';
export * from './workroom-runtime/workroom-data-lifecycle-human-ingress.js';
export * from './workroom-runtime/workroom-payload-processor-recall.js';
