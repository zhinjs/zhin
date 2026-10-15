// Barrel for the Workroom, Portfolio and Data Governance domain.
// Remote, scheduler/preemption, portfolio and data-governance exports live on the frozen
// `./remote`, `./scheduler`, `./portfolio` and `./data-governance` subpaths (not the package root).
export type {
  WorkroomMemberRole,
  WorkroomAssignmentRouteDefinition,
  WorkroomSpaceKind,
  WorkroomAgentMemberDefinition,
  WorkroomConversationBindingDefinition,
  WorkroomDefinition,
} from './workroom/catalog-definition.js';
export { validateWorkroomDefinitions } from './workroom/validate-catalog.js';
export * from './workroom/kernel-contracts.js';
export * from './workroom/acceptance-policy.js';
export * from './workroom/acceptance-control.js';
export * from './workroom/accepted-source-projector.js';
export * from './workroom/accepted-source-memory-application.js';
export * from './workroom/file-accepted-source-memory-repository.js';
export * from './workroom/project-knowledge-registry.js';
export * from './workroom/database-project-knowledge-journal.js';
export * from './workroom/workroom-assignment-knowledge-context.js';
export * from './workroom/assignment-executor.js';
export * from './workroom/assignment-authority.js';
export * from './workroom/assignment-observation-ingress.js';
export * from './workroom/interaction-space-router.js';
export * from './workroom/file-interaction-space-binding-repository.js';
export * from './workroom/interaction-space-binding-service.js';
export * from './workroom/human-ingress.js';
export * from './workroom/human-ingress-application.js';
export * from './workroom/file-human-ingress-application.js';
export * from './workroom/human-ingress-source-reader.js';
export * from './workroom/human-ingress-orchestrator.js';
export * from './workroom/dynamic-workflow-planner.js';
export * from './workroom/plan-approval-control.js';
export * from './workroom/plan-revision.js';
export * from './workroom/file-human-ingress.js';
export * from './workroom/local-assignment-issuance.js';
export * from './workroom/workroom-task-report-store.js';
export * from './workroom/projection-outbox/index.js';
export * from './workroom/journal/index.js';
export * from './workroom/journal-model.js';
export * from './workroom/catalog.js';
export * from './workroom/workroom-kernel.js';
export * from './workroom/workroom-run-control.js';
export * from './workroom/runtime.js';
export * from './workroom/profile-compiler.js';
export * from './workroom/profile-registry.js';
export * from './workroom/file-profile-journal.js';
export * from './workroom/workflow-plan-builder.js';
export * from './workroom/effect-ledger.js';
export * from './workroom/file-effect-ledger.js';
export * from './workroom/git-workspace-gateway.js';
export * from './workroom/effect-blocker-repository.js';
export * from './workroom/role-capability-snapshot.js';
export { LegacyEmbeddedPayloadDetectedError } from './workroom/journal/legacy-payload-guard.js';
export * from './workroom/assignment-authority-grant-application.js';
export * from './workroom/assignment-authority-grant-repository.js';
export type {
  WorkroomRunControlCommand,
  WorkroomRunControlReceipt,
} from './workroom/workroom-run-control.js';
export {
  createCatalogGovernedWorkroomProjectionAuthority,
  createCatalogGovernedConsoleDisclosureAuthority,
  createWorkroomRuntime,
  type WorkroomProjectionReadAuthorityPort,
  type WorkroomRunDetail,
  type WorkroomRunHeader,
  type WorkroomRuntimeHandle,
} from './workroom/runtime.js';
export { digestCanonicalWorkroomValue } from './workroom/canonical-value.js';
export * from './workroom/governed-dispatch-reasons.js';
export * from './workroom/github-workspace-transport.js';
export * from './workroom/software-delivery-plan.js';
export * from './workroom/coding-assignment-executor.js';
export * from './workroom/coding-git-objects.js';
export * from './workroom/file-coding-execution-store.js';

// Workroom runtime composition (formerly exported from @zhin.js/agent and @zhin.js/agent/runtime).
export {
  resolveWorkroomBotIdentity,
  type WorkroomBotIdentityInput,
  type ResolvedWorkroomBotIdentity,
} from './workroom-runtime/workroom-bot-identity.js';
export { defineWorkroomDatabaseModels } from './workroom-runtime/workroom-database-models.js';
export {
  prepareWorkroomDatabaseStorage,
  type PreparedWorkroomDatabaseStorage,
} from './workroom-runtime/workroom-database-storage.js';
export * from './workroom-runtime/database-overlay-pack-promotion-repository.js';
export * from './workroom-runtime/github-actions-delivery-provider.js';
export * from './workroom-runtime/github-exact-merge-gateway.js';
export * from './workroom-runtime/github-workroom-capability.js';
export * from './workroom-runtime/self-delivery-project-composition.js';
export * from './workroom-runtime/self-delivery-project.js';
export * from './workroom-runtime/workroom-acceptance-authority.js';
export * from './workroom-runtime/workroom-acceptance-fact-providers.js';
export * from './workroom-runtime/workroom-acceptance-internal-providers.js';
export * from './workroom-runtime/workroom-acceptance-policy.js';
export * from './workroom-runtime/workroom-acceptance-production-composition.js';
export * from './workroom-runtime/workroom-acceptance-provider-composition.js';
export * from './workroom-runtime/workroom-accepted-source-runtime.js';
export * from './workroom-runtime/workroom-assignment-authority-grant-runtime.js';
// The provider module declares Local* authority types that share names with the
// domain contracts re-exported above (workroom/local-assignment-issuance). Both
// were previously reachable through separate barrels (@zhin.js/agent vs
// @zhin.js/agent/runtime); the provider variants keep a `Provider` prefix here.
export {
  digestWorkroomCatalogProjectBinding,
  digestWorkroomGenerationDescriptor,
  digestWorkroomRemoteEndpointAuthority,
  createWorkroomGenerationAuthoritySnapshot,
  createWorkroomGenerationAuthoritySnapshotFromRuntime,
  GenerationOwnedWorkroomAssignmentAuthorityProvider,
  workroomProjectProfileRegistryToken,
  workroomAssignmentAuthorityGrantToken,
  workroomGenerationAuthoritySnapshotToken,
  workroomRemoteEndpointAuthorityToken,
  type WorkroomGenerationToolAuthority,
  type WorkroomGenerationSkillAuthority,
  type WorkroomGenerationAgentAuthority,
  type WorkroomGenerationAuthoritySnapshotInput,
  type WorkroomGenerationAuthoritySnapshot,
  type WorkroomRemoteEndpointAuthority,
  type WorkroomRemoteEndpointAuthorityPort,
  type GenerationOwnedWorkroomAssignmentAuthorityProviderOptions,
  type WorkroomLocalAssignmentAuthorityInput as WorkroomProviderLocalAssignmentAuthorityInput,
  type WorkroomLocalAssignmentResolvedAuthority as WorkroomProviderLocalAssignmentResolvedAuthority,
  type WorkroomLocalAssignmentAuthorityPort as WorkroomProviderLocalAssignmentAuthorityPort,
} from './workroom-runtime/workroom-assignment-authority-provider.js';
export * from './workroom-runtime/workroom-assignment-knowledge-composition.js';
export * from './workroom-runtime/workroom-capability-realization.js';
export * from './workroom-runtime/workroom-delivery-gateway.js';
export * from './workroom-runtime/workroom-dynamic-planning-provider.js';
export * from './workroom-runtime/workroom-dynamic-planning.js';
export * from './workroom-runtime/workroom-effect-composition.js';
export * from './workroom-runtime/workroom-effect-production.js';
export * from './workroom-runtime/workroom-effect-runtime.js';
export * from './workroom-runtime/workroom-governed-dispatch-composition.js';
export * from './workroom-runtime/workroom-host-port.js';
export * from './workroom-runtime/workroom-journal-payload-composition.js';
export * from './workroom-runtime/workroom-local-agent-core-adapter.js';
export * from './workroom-runtime/workroom-local-agent-loop.js';
export * from './workroom-runtime/workroom-local-assignment-authority.js';
export * from './workroom-runtime/workroom-local-assignment-executor.js';
export * from './workroom-runtime/workroom-local-assignment-runtime.js';
export * from './workroom-runtime/workroom-local-assignment-supply.js';
export * from './workroom-runtime/workroom-overlay-pack-promotion.js';
export * from './workroom-runtime/workroom-plan-gate-authority.js';
export * from './workroom-runtime/workroom-profile-authority-composition.js';
export * from './workroom-runtime/workroom-profile-authority-runtime.js';
export * from './workroom-runtime/workroom-projection-outbound.js';
export * from './workroom-runtime/workroom-projection-runtime.js';
export * from './workroom-runtime/workroom-reviewer-authority-runtime.js';
export * from './workroom-runtime/workroom-risk-acceptance-runtime.js';
export * from './workroom-runtime/workroom-run-profile-pin-authority.js';
export * from './room/index.js';
