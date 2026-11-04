import { createRootPrivateToken, type PluginId, type SnapshotLease, type SnapshotReader } from '@zhin.js/plugin-runtime';
import type { OperationResourceView, CapabilityOperationFactory } from '@zhin.js/feature-kit';
import type { InferenceGraphSnapshot } from '@zhin.js/ai/provider';
import type { TurnRequest } from '../turn/turn-ingress.js';

/** Host constructs inference from the trusted parent request and exact held generation. */
export interface AgentOperationResourcesInput {
  readonly lease: SnapshotLease;
  readonly snapshots: SnapshotReader;
  readonly request: TurnRequest;
  readonly owner: PluginId;
  readonly signal: AbortSignal;
  readonly inferenceSnapshot?: InferenceGraphSnapshot;
}
export interface AgentOperationResourcesPort { open(input: AgentOperationResourcesInput): OperationResourceView | undefined }
export const agentOperationResourcesToken = createRootPrivateToken<AgentOperationResourcesPort>(
  'zhin.agent.operation-resources', 'Host resources for one authorized Agent Tool execution',
);

/** This factory contains no shared client; each execute owns a separately closed resource view. */
export function createAgentOperationFactory(input: Omit<AgentOperationResourcesInput, 'owner'> & Readonly<{
  port?: AgentOperationResourcesPort;
  isActive(): boolean;
}>): CapabilityOperationFactory {
  return Object.freeze({ signal: input.signal, create: (request: Parameters<CapabilityOperationFactory['create']>[0]) => {
    if (!input.isActive() || !input.lease.active || !input.snapshots.owns(input.lease)) throw new Error('Agent Tool operation has ended');
    const signal = request.signal === input.signal ? input.signal : AbortSignal.any([input.signal, request.signal]);
    return Object.freeze({ signal, resources: input.port?.open({ lease: input.lease, snapshots: input.snapshots,
      request: input.request, owner: request.owner, signal, inferenceSnapshot: input.inferenceSnapshot }) });
  } });
}
