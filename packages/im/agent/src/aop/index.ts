/**
 * Agent Orchestration Plane — leftover pipeline helpers + collaboration (ADR 0027+).
 *
 * Default orchestration uses OrchestrationKernel + orchestration_* tools.
 * Model-facing cell_* pipeline tools were removed (ADR 0026).
 */
export * from '../collaboration/index.js';
export {
  resolveMemberBySender,
  resolveEndpointIdsForMember,
  isInboundFromPeerBot,
} from '../collaboration/endpoint-identity.js';
export {
  createInboundTurnPipeline,
} from '../collaboration/inbound-turn-pipeline.js';
export type {
  InboundTurnPipeline,
  InboundTurnPipelineDeps,
} from '../collaboration/inbound-turn-pipeline.js';
export * from './pipeline/index.js';
export * from './runtime/index.js';
