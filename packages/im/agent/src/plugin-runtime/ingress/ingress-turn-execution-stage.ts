import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  CapabilityIngress,
  rankDecisionCandidates,
  type AgentCapabilities,
  type AgentDecisionRuntime,
} from '../index.js';
import {
  intersectCapabilities,
  type TurnAccessContext,
  type TurnMergedSender,
} from '../../turn/index.js';
import type { routeSpecialistAgent } from './trigger.js';

/** Semantic selection only fills the gap left by explicit and platform routing. */
export async function selectDecisionAgentRoute(input: Readonly<{
  routed: ReturnType<typeof routeSpecialistAgent>;
  capabilities: Pick<AgentCapabilities, 'agents'>;
  decisionRuntime?: AgentDecisionRuntime;
  workroomTurn: boolean;
  signal: AbortSignal;
}>): Promise<ReturnType<typeof routeSpecialistAgent>> {
  if (input.routed.agent || input.workroomTurn || /^@[^\s:：]+/u.test(input.routed.userText)) {
    return input.routed;
  }
  const ranking = await rankDecisionCandidates(
    input.decisionRuntime,
    'agents',
    input.routed.userText,
    input.capabilities.agents.map(agent => ({
      name: agent.qualifiedName,
      description: agent.description,
    })),
    input.signal,
  );
  if (!ranking.applied || ranking.selectedNames.length === 0) return input.routed;
  const agent = input.capabilities.agents.find(candidate => candidate.qualifiedName === ranking.selectedNames[0]);
  return agent ? { ...input.routed, agent } : input.routed;
}

export async function readTurnCapabilities(
  ingress: CapabilityIngress,
  snapshot: RuntimeSnapshot,
  requester: PluginId,
  carrier: TurnAccessContext,
  members: readonly TurnAccessContext[] | undefined,
  isActive: () => boolean,
): Promise<Readonly<{
  capabilities: AgentCapabilities;
  /** Merged turn only: every member (carrier first) and the Tool names each sees alone. */
  members: readonly TurnAccessContext[];
  memberTools: readonly (readonly string[])[];
}>> {
  const own = await ingress.read({ snapshot: snapshot, owner: requester, isActive: isActive, turn: carrier });
  if (!members) return { capabilities: own, members: [], memberTools: [] };
  const others = members.filter((member) => member !== carrier);
  const reads = await Promise.all(others.map((member) => ingress.read({ snapshot: snapshot, owner: requester, isActive: isActive, turn: member })));
  return {
    capabilities: intersectCapabilities(own, reads),
    members: [carrier, ...others],
    memberTools: [own, ...reads].map((read) => read.tools.map((tool) => tool.name)),
  };
}

/**
 * Every member's own access (ADR 0038 §2). A participant admitted without one
 * cannot be checked, so the turn falls back to the anonymous `user` floor:
 * nothing beyond what an unknown group member could use.
 */
export function mergedMemberAccess(
  participants: readonly Readonly<{ senderId: string; access?: TurnAccessContext }>[],
  carrier: TurnAccessContext,
): readonly TurnAccessContext[] {
  return participants.map((participant) => participant.access ?? anonymousMemberAccess(carrier, participant.senderId));
}

/** The structured sender list a merged turn's context carries (ADR 0038 §3). */
export function mergedTurnSenders(
  participants: readonly Readonly<{ senderId: string; senderName?: string; texts: readonly string[]; messageIds?: readonly string[] }>[],
): readonly TurnMergedSender[] {
  return Object.freeze(participants.map((participant) => Object.freeze({
    subjectId: participant.senderId,
    ...(participant.senderName ? { displayName: participant.senderName } : {}),
    ...(participant.messageIds?.length ? { messageIds: participant.messageIds } : {}),
    texts: participant.texts,
  })));
}

export function anonymousMemberAccess(carrier: TurnAccessContext, senderId: string): TurnAccessContext {
  return Object.freeze({
    ...carrier,
    principal: Object.freeze({ subjectId: senderId, roles: Object.freeze(['user']) }),
    policy: Object.freeze({ ...carrier.policy, permissions: Object.freeze(['user']) }),
  });
}
