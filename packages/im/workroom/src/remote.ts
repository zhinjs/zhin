/**
 * Workroom remote dispatch / callback / assignment (A2A extension).
 *
 * FROZEN: not part of the package root entry or the default assembly path.
 * Kept only for the optional A2A remote transport (`a2a.workroomCallbacks` /
 * `a2a.workroomRemoteExecutors`). New code must not depend on it.
 */
export * from './workroom/remote-callback-inbox.js';
export * from './workroom/remote-callback-reconciliation-worker.js';
export * from './workroom/remote-callback-application.js';
export * from './workroom/remote-callback-gateway.js';
export * from './workroom/remote-dispatch.js';
export * from './workroom/remote-dispatch-outbox.js';
export * from './workroom/remote-dispatch-worker.js';
export * from './workroom/remote-dispatch-admission.js';
export * from './workroom/remote-dispatch-scheduler.js';
export * from './workroom/remote-assignment-issuance.js';
export * from './workroom/remote-assignment-dispatch-command.js';
export * from './workroom/remote-executor.js';
export * from './workroom-runtime/workroom-remote-assignment-authority.js';
export * from './workroom-runtime/workroom-remote-callback-runtime.js';
export * from './workroom-runtime/workroom-remote-executor.js';
