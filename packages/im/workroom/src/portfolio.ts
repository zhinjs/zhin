/**
 * Workroom portfolio (journal, admission, capacity control outbox, sponsor, runtime composition).
 *
 * FROZEN: moved out of the package root entry (C4b). The default (legacy Kernel)
 * assembly path in `@zhin.js/cli` still creates these modules; they are only
 * not part of the root exports. The new Room core does not depend on them.
 * New code must not depend on it.
 */
export * from './portfolio/portfolio-journal.js';
export * from './portfolio/file-portfolio-journal.js';
export * from './portfolio/portfolio-admission.js';
export * from './portfolio/capacity-control-outbox.js';
export * from './portfolio/file-capacity-control-outbox.js';
export * from './portfolio/database-capacity-control-outbox.js';
export * from './portfolio/sponsor-projection.js';
export * from './portfolio/resource-bundle.js';
export * from './workroom-runtime/workroom-portfolio-capacity.js';
export * from './workroom-runtime/workroom-portfolio-checkpoint-ack.js';
export * from './workroom-runtime/workroom-portfolio-control-composition.js';
export * from './workroom-runtime/workroom-portfolio-control-runtime.js';
export * from './workroom-runtime/workroom-portfolio-grant-assignment.js';
export * from './workroom-runtime/workroom-portfolio-kernel-authority.js';
export * from './workroom-runtime/workroom-portfolio-sponsor.js';
