/**
 * Collaboration config normalization — DB is SSOT; yaml roster 仅供 /collab init 模板。
 */

import type { CollaborationCell, CollaborationCellConfig, CollaborationConfig, CollaborationCellMember } from './types.js';
import { isPipelineRole } from './types.js';
import { getSceneIdentityService } from './scene-identity-service.js';

export function normalizeCollaborationConfig(raw: unknown): CollaborationConfig {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const enabled = obj.enabled === true || obj.enabled === undefined && hasLegacyCells(obj);
  const defaultGoal = typeof obj.defaultGoal === 'string' ? obj.defaultGoal.trim() : undefined;
  const roster = parseRosterMap(obj.roster);
  return {
    enabled,
    defaultGoal: defaultGoal || undefined,
    roster: roster && Object.keys(roster).length ? roster : undefined,
  };
}

function hasLegacyCells(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj.cells) && obj.cells.length > 0;
}

function parseMemberEntry(m: unknown): CollaborationCellMember | null {
  if (!m || typeof m !== 'object') return null;
  const mem = m as Record<string, unknown>;
  const endpoint = typeof mem.endpoint === 'string' ? mem.endpoint : '';
  const primary = typeof mem.primary === 'string' ? mem.primary : '';
  if (!endpoint || !primary) return null;
  const pipelineRole = isPipelineRole(mem.pipelineRole) ? mem.pipelineRole : undefined;
  return {
    endpoint,
    primary,
    role: typeof mem.role === 'string' ? mem.role : undefined,
    pipelineRole,
  };
}

function parseRosterMap(raw: unknown): Record<string, CollaborationCellMember[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, CollaborationCellMember[]> = {};
  for (const [adapter, membersRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(membersRaw)) continue;
    const members = membersRaw
      .map((m) => parseMemberEntry(m))
      .filter((m): m is CollaborationCellMember => m != null);
    if (members.length) out[adapter] = members;
  }
  return Object.keys(out).length ? out : undefined;
}

/** @deprecated 仅测试/迁移；新代码请用 roster + /collab init */
export function parseCellConfigs(cellsRaw: unknown[]): CollaborationCellConfig[] {
  const cells: CollaborationCellConfig[] = [];
  for (const entry of cellsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    const id = typeof c.id === 'string' ? c.id : '';
    const adapter = typeof c.adapter === 'string' ? c.adapter : '';
    const sceneId = typeof c.sceneId === 'string' ? c.sceneId : '';
    if (!id || !adapter || !sceneId) continue;
    const membersRaw = Array.isArray(c.members) ? c.members : [];
    const members = membersRaw
      .map((m) => parseMemberEntry(m))
      .filter((m): m is CollaborationCellMember => m != null);
    if (members.length === 0) continue;
    cells.push({
      id,
      adapter,
      sceneId,
      goal: typeof c.goal === 'string' ? c.goal : undefined,
      missionRunId: typeof c.missionRunId === 'string' ? c.missionRunId : undefined,
      members,
    });
  }
  return cells;
}

export function configCellToRuntime(cell: CollaborationCellConfig): CollaborationCell {
  return {
    id: cell.id,
    adapter: cell.adapter,
    sceneId: cell.sceneId,
    goal: cell.goal,
    missionRunId: cell.missionRunId,
    members: cell.members.map((m) => ({
      endpointId: m.endpoint,
      primary: m.primary,
      role: m.role,
      pipelineRole: m.pipelineRole,
    })),
  };
}

export function findCellForMessage(
  cells: CollaborationCell[],
  adapter: string,
  sceneId: string,
): CollaborationCell | undefined {
  const ad = String(adapter);
  const sid = String(sceneId);
  return cells.find((c) => c.adapter === ad && String(c.sceneId) === sid);
}

/** 成员 transport adapter（缺省继承 Cell）。 */
export function memberTransportAdapter(
  cell: CollaborationCell,
  member: CollaborationCell['members'][number],
): string {
  return member.adapter ?? cell.adapter;
}

/**
 * 入站 Cell 查找：scene_aliases → (adapter, sceneId) 直查 → endpoint 成员反查。
 */
export function findCellForInbound(
  cells: CollaborationCell[],
  adapter: string,
  sceneId: string,
  endpointId?: string,
): CollaborationCell | undefined {
  const fromSceneIndex = getSceneIdentityService().resolveLogicalCell(adapter, sceneId, endpointId);
  if (fromSceneIndex) return fromSceneIndex;

  const direct = findCellForMessage(cells, adapter, sceneId);
  if (direct) return direct;
  if (!endpointId) return undefined;
  return cells.find((c) =>
    c.members.some(
      (m) => m.endpointId === endpointId && memberTransportAdapter(c, m) === adapter,
    ),
  );
}

/**
 * 通过 SceneIdentityService 解析逻辑 Cell。优先用此函数代替 findCellForMessage。
 */
export function resolveCellForScene(
  adapter: string,
  sceneId: string,
  endpointId?: string,
): CollaborationCell | undefined {
  return getSceneIdentityService().resolveLogicalCell(adapter, sceneId, endpointId);
}

export function findCellMemberByEndpoint(
  cell: CollaborationCell,
  endpointId: string,
  adapter?: string,
): CollaborationCell['members'][number] | undefined {
  if (adapter) {
    return cell.members.find(
      (m) => m.endpointId === endpointId && memberTransportAdapter(cell, m) === adapter,
    );
  }
  return cell.members.find((m) => m.endpointId === endpointId);
}

export function resolvePrimaryForEndpoint(
  cell: CollaborationCell | undefined,
  endpointId: string,
  fallback: string,
): string {
  if (!cell) return fallback;
  return findCellMemberByEndpoint(cell, endpointId)?.primary ?? fallback;
}

export function endpointHasPeerInCell(
  cell: CollaborationCell | undefined,
  agentName: string,
): { hasPeer: boolean; peerEndpointId?: string } {
  if (!cell) return { hasPeer: false };
  const member = cell.members.find((m) => m.primary === agentName);
  if (!member) return { hasPeer: false };
  const peer = cell.members.find((m) => m.endpointId !== member.endpointId);
  if (!peer) return { hasPeer: false };
  return { hasPeer: true, peerEndpointId: peer.endpointId };
}

/**
 * Resolve group_delegate peerEndpoint — accepts endpoint ID, pipelineRole, or primary agent name.
 */
export function resolvePeerEndpointInCell(
  cell: CollaborationCell,
  peerRef: string,
): string | undefined {
  const ref = peerRef.trim();
  if (!ref) return undefined;

  const byEndpoint = cell.members.find((m) => m.endpointId === ref);
  if (byEndpoint) return byEndpoint.endpointId;

  const refLower = ref.toLowerCase();
  const byPipelineRole = cell.members.find(
    (m) => m.pipelineRole?.toLowerCase() === refLower,
  );
  if (byPipelineRole) return byPipelineRole.endpointId;

  const byPrimary = cell.members.find((m) => m.primary.toLowerCase() === refLower);
  if (byPrimary) return byPrimary.endpointId;

  const byRole = cell.members.find((m) => m.role?.toLowerCase() === refLower);
  if (byRole) return byRole.endpointId;

  return undefined;
}
