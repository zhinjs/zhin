/** @internal Runtime 内部：CapabilitySlot（feature 与 projection 之间的载体）。 */
export * from './capability.js';
export * from './dispose.js';
export * from './identity.js';
export * from './generation-store.js';
export * from './handoff.js';
/** @public 用户侧创作面：`definePlugin`（`plugin.ts` 约定入口，承诺 semver）。 */
export * from './plugin.js';
/** @internal Runtime 内部：RootRuntime / RootController。 */
export * from './root-controller.js';
export * from './shared-lifetime.js';
/** @internal Runtime 内部：SnapshotStore / RuntimeSnapshot。 */
export * from './snapshot.js';
export * from './token.js';
/** @public Host token：`scheduleHostToken`（承诺 semver）。 */
export * from './schedule-host.js';
/** @public Host token：`databaseHostToken`（承诺 semver）。 */
export * from './database-host.js';
/** @public Host token：`agentToolsHostToken`（experimental）。 */
export * from './agent-tools-host.js';
export * from './html-renderer.js';
/** @public Host token：`outboundHostToken`（承诺 semver）。 */
export * from './outbound-host.js';
export * from './inbox.js';
export * from './system-log.js';
