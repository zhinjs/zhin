import { agentHostToken, type AgentHostPort } from '../agent-host-port.js';
import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import { agentFeatureId, isAgentIndex } from '@zhin.js/agent-feature';
import {
  decodeTaskTarget,
  encodeTaskTarget,
  encodeStorageIdentity,
  type DatabaseHost,
  type RuntimeSnapshot,
  type SnapshotLease,
} from '@zhin.js/plugin-runtime';
import type { StructuredDatabase } from '@zhin.js/database';
import type { ConversationRef } from '@zhin.js/im-contract';
import { inferencePolicyKeys } from './turn-context.js';
import type { SubAgentModelKey } from '../../model-runtime/types.js';

export interface InferenceEndpointAddress {
  readonly rootId: string;
  readonly platform: string;
  readonly endpoint: string;
  readonly adapterId: string;
}
export interface InferenceSceneAddress {
  readonly rootId: string;
  readonly platform: string;
  readonly endpoint: string;
  readonly conversation: ConversationRef;
}

export interface InferenceTargetPage {
  readonly limit: number;
  readonly offset: number;
}
export interface InferenceTargets {
  readonly agentsAvailable: boolean;
  readonly agents: readonly Readonly<{ name: string; nickname?: string }>[];
  /**
   * Sub-agents (`agents/<name>/` of plugins) a `purposes.agents.<key>` model choice can name (#1270).
   * `qualifiedName` (`<plugin>__<agent>`) always works; `kind` says whether the bare `name` does too:
   * `bare` (unique and no binding uses it, or the project's own sub-agent, whose qualified name is
   * the bare name), `shared` (several sub-agents have it) or `binding` (an Agent binding has that
   * name, so the key belongs to the binding).
   */
  readonly subAgents: readonly SubAgentTarget[];
  readonly adaptersAvailable: boolean;
  readonly adapters: readonly Readonly<{
    capabilityId: string;
    platform: string;
  }>[];
  readonly endpoints: readonly Readonly<{
    capabilityId: string;
    instanceId: string;
    key: string;
    address: InferenceEndpointAddress;
  }>[];
  readonly scenesAvailable: boolean;
  readonly scenesError?: 'not_requested' | 'unavailable' | 'integrity';
  readonly scenes: readonly Readonly<{
    key: string;
    address: InferenceSceneAddress;
  }>[];
  readonly sceneHasMore: boolean;
}
export interface SubAgentTarget {
  readonly qualifiedName: string;
  readonly name: string;
  readonly kind: 'bare' | 'shared' | 'binding';
}

/** Agent binding names and sub-agents of one generation, for purpose effects (#1270). */
export interface AgentPurposeTargets {
  readonly bindingNames: readonly string[];
  readonly subAgents: readonly SubAgentTarget[];
}

/** Reads the binding names and the sub-agent list of `snapshot`; empty lists when the Agent is absent. */
export function readAgentPurposeTargets(snapshot: RuntimeSnapshot): AgentPurposeTargets {
  const agentHost = snapshot.resources.get(snapshot.root)?.get(agentHostToken.id) as AgentHostPort | undefined;
  // The runtime's binding names (configured `ai.agents` only, #1250 batch 21): a name merely
  // discovered from `agents/<name>/` is a sub-agent, and its key must not read as a binding's.
  const configured = agentHost?.protocol.listConfiguredBindingNames?.()
    ?? agentHost?.protocol.listBindings().map(binding => binding.name) ?? [];
  const bindingNames = ['zhin', ...configured];
  const index = snapshot.projections.get(agentFeatureId);
  const descriptors = isAgentIndex(index) ? index.list() : [];
  const counts = new Map<string, number>();
  for (const agent of descriptors) counts.set(agent.name, (counts.get(agent.name) ?? 0) + 1);
  const bindings = new Set(bindingNames);
  const subAgents = descriptors
    .map((agent): SubAgentTarget => Object.freeze({
      qualifiedName: agent.qualifiedName,
      name: agent.name,
      // The project's own sub-agent: its qualified name is the bare name, which always reaches it
      // (an `ai.agents.<name>` binding of that name is the same agent, #1250 batch 21).
      kind: agent.qualifiedName === agent.name && agent.name !== 'zhin' ? 'bare'
        : bindings.has(agent.name) ? 'binding' : (counts.get(agent.name) ?? 0) > 1 ? 'shared' : 'bare',
    }))
    .sort((a, b) => (a.qualifiedName < b.qualifiedName ? -1 : a.qualifiedName > b.qualifiedName ? 1 : 0));
  return Object.freeze({ bindingNames: Object.freeze([...new Set(bindingNames)]), subAgents: Object.freeze(subAgents) });
}

/**
 * `purposes.agents` lookup key of the specialist a turn was routed to (`selection.agent`: its
 * qualified name, or a bare name), from the generation's agent list (#1250 agent-purpose-binding-ignored).
 * `undefined` when no agent of that name is listed: the turn is then the binding itself (e.g. a
 * configured `ai.agents.support` run through `protocol.execute`) and runs on the binding's purpose.
 */
export function specialistModelKey(snapshot: RuntimeSnapshot, agent: string | undefined): SubAgentModelKey | undefined {
  const selected = agent?.trim();
  if (!selected || selected === 'zhin') return undefined;
  const index = snapshot.projections.get(agentFeatureId);
  const descriptors = isAgentIndex(index) ? index.list() : [];
  const found = descriptors.find(item => item.qualifiedName === selected) ?? descriptors.find(item => item.name === selected);
  if (!found) return undefined;
  const shared = descriptors.filter(item => item.name === found.name).length > 1;
  return Object.freeze({ name: found.name, qualifiedName: found.qualifiedName, ...(shared ? { bareNameShared: true } : {}) });
}

export type InferenceTargetsReader = (page?: InferenceTargetPage) => Promise<InferenceTargets>;
const COLUMNS = [
  'endpoint_adapter',
  'endpoint_id',
  'conversation_kind',
  'conversation_id',
  'parent_kind',
  'parent_id',
  'thread_id',
] as const;

/** Reads only the leased generation's Adapter metadata and existing indexed conversation address columns. */
export function createInferenceTargetsReader(
  options: Readonly<{
    rootId: string;
    lease: SnapshotLease;
    database?: DatabaseHost;
  }>
): InferenceTargetsReader {
  return async (page) => {
    const index = options.lease.value.projections.get(adapterFeatureId);
    const adapters: Array<{ capabilityId: string; platform: string }> = [];
    const endpoints: Array<{
      capabilityId: string;
      instanceId: string;
      key: string;
      address: InferenceEndpointAddress;
    }> = [];
    if (isAdapterIndex(index))
      for (const adapter of index.adapters()) {
        const descriptor = adapter.descriptor;
        adapters.push({
          capabilityId: descriptor.id,
          platform: descriptor.name,
        });
        for (const endpoint of adapter.list())
          endpoints.push({
            capabilityId: descriptor.id,
            instanceId: endpoint.instanceId,
            key: JSON.stringify([
              options.rootId,
              descriptor.name,
              endpoint.endpointId,
              endpoint.canonicalId,
            ]),
            address: {
              rootId: options.rootId,
              platform: descriptor.name,
              endpoint: endpoint.endpointId,
              adapterId: endpoint.canonicalId,
            },
          });
      }
    const agentHost = options.lease.value.resources
      .get(options.lease.value.root)
      ?.get(agentHostToken.id) as AgentHostPort | undefined;
    const agents =
      agentHost?.protocol.listBindings().map((binding) => ({
        name: binding.name,
        ...(binding.nickname ? { nickname: binding.nickname } : {}),
      })) ?? [];
    const common = {
      agentsAvailable: agentHost !== undefined,
      agents: Object.freeze(agents),
      subAgents: readAgentPurposeTargets(options.lease.value).subAgents,
      adaptersAvailable: isAdapterIndex(index),
      adapters: Object.freeze(adapters),
      endpoints: Object.freeze(endpoints),
    };
    const unavailable = (
      scenesError: 'not_requested' | 'unavailable' | 'integrity'
    ): InferenceTargets =>
      Object.freeze({
        ...common,
        scenesAvailable: false,
        scenesError,
        scenes: Object.freeze([]),
        sceneHasMore: false,
      });
    if (!page) return unavailable('not_requested');
    const database = options.database;
    if (!database?.started || !['sqlite', 'mysql', 'pg'].includes(database.dialect))
      return unavailable('unavailable');
    const raw = database.getRawDatabase() as Pick<StructuredDatabase, 'models'> | undefined;
    const model = raw?.models.get('conversation_events');
    if (!model) return unavailable('unavailable');
    if (!common.adaptersAvailable) return unavailable('unavailable');
    if (!endpoints.length)
      return Object.freeze({
        ...common,
        scenesAvailable: true,
        scenes: Object.freeze([]),
        sceneHasMore: false,
      });
    let rows: Record<string, unknown>[];
    try {
      // Full address GROUP BY is distinct in SQL. No event_json/message payload is selected.
      const query = model.select(...COLUMNS).where({
        endpoint_id: {
          $in: endpoints.map((endpoint) => encodeStorageIdentity(endpoint.address.adapterId)),
        },
      });
      query.groupBy(...COLUMNS);
      for (const column of COLUMNS) query.orderBy(column, 'ASC');
      rows = await query.limit(page.limit + 1).offset(page.offset);
    } catch {
      return unavailable('unavailable');
    }
    try {
      const scenes = rows.slice(0, page.limit).map((row) => {
        const conversation = decodeTaskTarget(row);
        const canonical = encodeTaskTarget(conversation);
        if (COLUMNS.some((column) => canonical[column] !== row[column]))
          throw new Error('Invalid stored address');
        const endpoint = endpoints.find(
          (endpoint) => endpoint.address.adapterId === conversation.endpoint.id
        );
        if (!endpoint) throw new Error('Unknown endpoint identity');
        const address: InferenceSceneAddress = {
          rootId: options.rootId,
          platform: endpoint.address.platform,
          endpoint: endpoint.address.endpoint,
          conversation,
        };
        return Object.freeze({
          address,
          key: inferencePolicyKeys(address).sceneKey,
        });
      });
      return Object.freeze({
        ...common,
        scenesAvailable: true,
        scenes: Object.freeze(scenes),
        sceneHasMore: rows.length > page.limit,
      });
    } catch {
      return unavailable('integrity');
    }
  };
}
