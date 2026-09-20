import type { ConsoleRpcExtendedCtx, ExtendedRpcResult } from './contracts.js';
import {
  errorMessage, optionalRpcText, optionalRpcTextArray, requiredRpcBoolean, requiredRpcInteger,
  requiredRpcText, requiredRpcValue,
} from './rpc-values.js';

export async function mutateWorkroomProfile(
  type: 'workroom.profile.status' | 'workroom.profile.bootstrap'
    | 'workroom.profile.pack.publish' | 'workroom.profile.publish'
    | 'workroom.profile.rollback' | 'workroom.profile.policy.publish',
  data: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const control = ctx.workroomProfileControl;
  if (!control) return { error: 'Workroom Profile authority control is unavailable' };
  for (const forbidden of [
    'authenticatedPrincipalId', 'principalId', 'decision', 'governance', 'approval', 'authority',
  ]) {
    if (forbidden in data) return { error: `Console Workroom Profile request cannot carry ${forbidden}` };
  }
  if (type === 'workroom.profile.status') {
    try {
      return { data: await control.getPlanningStatus(
        requiredRpcText(data.projectId, 'projectId'),
        ctx.authenticatedPrincipal,
      ) };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }
  const principal = ctx.authenticatedPrincipal;
  if (!principal) return { error: 'Workroom Profile control requires an authenticated principal' };
  try {
    const operationId = requiredRpcText(data.operationId, 'operationId');
    if (type === 'workroom.profile.bootstrap') {
      const projectId = requiredRpcText(data.projectId, 'projectId');
      const includeTools = optionalRpcTextArray(data.includeTools, 'includeTools');
      const includeSkills = optionalRpcTextArray(data.includeSkills, 'includeSkills');
      return { data: await control.bootstrapPlanning(Object.freeze({
        operationId,
        projectId,
        expectedRegistryRevision: requiredRpcInteger(
          data.expectedRegistryRevision,
          'expectedRegistryRevision',
          -1,
        ),
        ...(includeTools ? { includeTools } : {}),
        ...(includeSkills ? { includeSkills } : {}),
      }), principal) };
    }
    if (type === 'workroom.profile.pack.publish') {
      return { data: await control.publishPack(Object.freeze({ operationId, pack: requiredRpcValue(data.pack, 'pack') }), principal) };
    }
    const projectId = requiredRpcText(data.projectId, 'projectId');
    if (type === 'workroom.profile.policy.publish') {
      const expectedPreviousDigest = optionalRpcText(data.expectedPreviousDigest, 'expectedPreviousDigest');
      return { data: await control.publishPlanningPolicy(Object.freeze({
        operationId,
        projectId,
        profileRevisionId: requiredRpcText(data.profileRevisionId, 'profileRevisionId'),
        revision: requiredRpcInteger(data.revision, 'revision'),
        ...(expectedPreviousDigest ? { expectedPreviousDigest } : {}),
        policy: requiredRpcValue(data.policy, 'policy'),
      }), principal) };
    }
    const common = {
      operationId,
      projectId,
      expectedRegistryRevision: requiredRpcInteger(data.expectedRegistryRevision, 'expectedRegistryRevision', -1),
      overlay: requiredRpcValue(data.overlay, 'overlay'),
      activate: requiredRpcBoolean(data.activate, 'activate'),
    };
    return type === 'workroom.profile.rollback'
      ? { data: await control.publishRollback(Object.freeze({
          ...common,
          restoredFromRevisionId: requiredRpcText(data.restoredFromRevisionId, 'restoredFromRevisionId'),
        }), principal) }
      : { data: await control.publishProfile(Object.freeze(common), principal) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function mutateWorkroomKnowledge(
  type: 'workroom.knowledge.get' | 'workroom.knowledge.publish' | 'workroom.knowledge.rollback',
  data: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const control = ctx.workroomKnowledgeControl;
  if (!control) return { error: 'Workroom Knowledge control is unavailable' };
  for (const forbidden of [
    'authenticatedPrincipalId', 'principalId', 'ownerPrincipalId', 'source', 'decision',
    'governance', 'approval', 'authority', 'body', 'content',
  ]) {
    if (forbidden in data) return { error: `Console Workroom Knowledge request cannot carry ${forbidden}` };
  }
  try {
    const projectId = requiredRpcText(data.projectId, 'projectId');
    if (type === 'workroom.knowledge.get') return { data: await control.read(projectId) };
    const principal = ctx.authenticatedPrincipal;
    if (!principal) return { error: 'Workroom Knowledge mutation requires an authenticated principal' };
    const common = {
      operationId: requiredRpcText(data.operationId, 'operationId'), projectId,
      expectedRevision: requiredRpcInteger(data.expectedRevision, 'expectedRevision', -1),
    };
    if (type === 'workroom.knowledge.rollback') {
      return { data: await control.rollback(Object.freeze({
        ...common, restoreRevision: requiredRpcInteger(data.restoreRevision, 'restoreRevision', 0),
      }), principal) };
    }
    if (!Array.isArray(data.entries)) throw new Error('entries is invalid');
    return { data: await control.publish(Object.freeze({ ...common, entries: structuredClone(data.entries) }), principal) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
