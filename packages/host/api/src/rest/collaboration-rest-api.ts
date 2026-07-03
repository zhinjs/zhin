/**
 * Collaboration REST — GroupCell + Members CRUD（数据库 SSOT，ADR 0023）
 *
 * Cells:
 *   GET    /api/collaboration/cells?endpointId=
 *   GET    /api/collaboration/cells/:id
 *   POST   /api/collaboration/cells
 *   PUT    /api/collaboration/cells/:id
 *   DELETE /api/collaboration/cells/:id
 *
 * Members:
 *   GET    /api/collaboration/cells/:id/members
 *   POST   /api/collaboration/cells/:id/members
 *   PUT    /api/collaboration/cells/:id/members/:endpointId
 *   DELETE /api/collaboration/cells/:id/members/:endpointId
 *
 * Reverse lookup:
 *   GET    /api/collaboration/endpoints/:endpointId/cells
 */
import { getCollaborationCellService, getCollaborationArtifactRepository } from '@zhin.js/agent';
import {
  registerFetchRoute,
  type Router,
  type RouterContext,
} from '@zhin.js/host-router/router';

type MemberPayload = {
  endpointId: string;
  primary: string;
  role?: string;
  pipelineRole?: string;
  peerSenderId?: string;
  sortOrder?: number;
  enabled?: boolean;
};

function parseMember(row: unknown): MemberPayload | null {
  if (!row || typeof row !== 'object') return null;
  const m = row as Record<string, unknown>;
  const endpointId = String(m.endpointId ?? m.endpoint ?? '');
  const primary = String(m.primary ?? '');
  if (!endpointId || !primary) return null;
  return {
    endpointId,
    primary,
    role: typeof m.role === 'string' ? m.role : undefined,
    pipelineRole: typeof m.pipelineRole === 'string' ? m.pipelineRole : undefined,
    peerSenderId: typeof m.peerSenderId === 'string' ? m.peerSenderId : undefined,
    sortOrder: typeof m.sortOrder === 'number' ? m.sortOrder : undefined,
    enabled: typeof m.enabled === 'boolean' ? m.enabled : undefined,
  };
}

function parseMembers(body: unknown): MemberPayload[] | null {
  if (!Array.isArray(body)) return null;
  const members = body.map(parseMember).filter((m): m is MemberPayload => m != null);
  return members;
}

export function registerCollaborationRoutes(router: Router, base: string): void {
  const svc = () => getCollaborationCellService();

  registerFetchRoute(router, 'GET', `${base}/collaboration/cells`, async (ctx: RouterContext) => {
    const endpointId = typeof ctx.query.endpointId === 'string' ? ctx.query.endpointId : '';
    if (endpointId) {
      const cells = (await svc().findCellsByEndpoint(endpointId)).map((c) => svc().toSnapshot(c));
      ctx.status = 200;
      ctx.body = { success: true, data: { cells, endpointId } };
      return;
    }
    await svc().reloadFromRepository();
    const cells = svc().listCells().map((c) => svc().toSnapshot(c));
    ctx.status = 200;
    ctx.body = { success: true, data: { cells } };
  });

  registerFetchRoute(router, 'GET', `${base}/collaboration/endpoints/:endpointId/cells`, async (ctx: RouterContext) => {
    const endpointId = ctx.params.endpointId;
    const cells = (await svc().findCellsByEndpoint(endpointId)).map((c) => svc().toSnapshot(c));
    ctx.status = 200;
    ctx.body = { success: true, data: { endpointId, cells } };
  });

  registerFetchRoute(router, 'GET', `${base}/collaboration/cells/:id`, async (ctx: RouterContext) => {
    const id = ctx.params.id;
    const cell = await svc().getCellFresh(id);
    if (!cell) {
      ctx.status = 404;
      ctx.body = { success: false, error: `Cell ${id} not found` };
      return;
    }
    ctx.status = 200;
    ctx.body = { success: true, data: svc().toSnapshot(cell) };
  });

  registerFetchRoute(router, 'POST', `${base}/collaboration/cells`, async (ctx: RouterContext) => {
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    const adapter = typeof body.adapter === 'string' ? body.adapter : '';
    const sceneId = typeof body.sceneId === 'string' ? body.sceneId : '';
    if (!id || !adapter || !sceneId) {
      ctx.status = 400;
      ctx.body = { success: false, error: '请提供 id, adapter, sceneId' };
      return;
    }
    const members = body.members != null ? parseMembers(body.members) : undefined;
    if (body.members != null && !members?.length) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'members 无效' };
      return;
    }
    const cell = await svc().upsertCell({
      id,
      adapter,
      sceneId,
      goal: typeof body.goal === 'string' ? body.goal : undefined,
      missionRunId: typeof body.missionRunId === 'string' ? body.missionRunId : undefined,
      members: members ?? undefined,
    });
    ctx.status = 201;
    ctx.body = { success: true, data: svc().toSnapshot(cell) };
  });

  registerFetchRoute(router, 'PUT', `${base}/collaboration/cells/:id`, async (ctx: RouterContext) => {
    const id = ctx.params.id;
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const existing = await svc().getCellFresh(id);
    if (!existing) {
      ctx.status = 404;
      ctx.body = { success: false, error: `Cell ${id} not found` };
      return;
    }

    if (typeof body.goal === 'string' && body.members == null && body.adapter == null && body.sceneId == null) {
      const version = typeof body.version === 'number' ? body.version : undefined;
      const result = await svc().setGoal(id, body.goal, version);
      if (!result.ok) {
        ctx.status = result.error?.includes('conflict') ? 409 : 400;
        ctx.body = { success: false, error: result.error };
        return;
      }
      const cell = svc().getCell(id);
      ctx.status = 200;
      ctx.body = { success: true, data: cell ? svc().toSnapshot(cell) : undefined };
      return;
    }

    const members = body.members != null ? parseMembers(body.members) : undefined;
    if (body.members != null && !members?.length) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'members 无效' };
      return;
    }
    const cell = await svc().upsertCell({
      id,
      adapter: typeof body.adapter === 'string' ? body.adapter : existing.adapter,
      sceneId: typeof body.sceneId === 'string' ? body.sceneId : existing.sceneId,
      goal: typeof body.goal === 'string' ? body.goal : existing.goal,
      missionRunId: typeof body.missionRunId === 'string' ? body.missionRunId : existing.missionRunId,
      members: members ?? undefined,
      enabled: body.enabled === false ? false : true,
    });
    ctx.status = 200;
    ctx.body = { success: true, data: svc().toSnapshot(cell) };
  });

  registerFetchRoute(router, 'DELETE', `${base}/collaboration/cells/:id`, async (ctx: RouterContext) => {
    const id = ctx.params.id;
    const ok = await svc().deleteCell(id);
    if (!ok) {
      ctx.status = 404;
      ctx.body = { success: false, error: `Cell ${id} not found` };
      return;
    }
    ctx.status = 200;
    ctx.body = { success: true };
  });

  registerFetchRoute(router, 'GET', `${base}/collaboration/cells/:id/members`, async (ctx: RouterContext) => {
    const id = ctx.params.id;
    const cell = await svc().getCellFresh(id);
    if (!cell) {
      ctx.status = 404;
      ctx.body = { success: false, error: `Cell ${id} not found` };
      return;
    }
    const members = await svc().listMembers(id);
    ctx.status = 200;
    ctx.body = { success: true, data: { cellId: id, members } };
  });

  registerFetchRoute(router, 'POST', `${base}/collaboration/cells/:id/members`, async (ctx: RouterContext) => {
    const id = ctx.params.id;
    const member = parseMember(ctx.request.body);
    if (!member) {
      ctx.status = 400;
      ctx.body = { success: false, error: '请提供 endpointId, primary' };
      return;
    }
    const result = await svc().addMember(id, member);
    if (!result.ok) {
      ctx.status = result.error?.includes('not found') ? 404 : 409;
      ctx.body = { success: false, error: result.error };
      return;
    }
    const cell = svc().getCell(id);
    ctx.status = 201;
    ctx.body = { success: true, data: { member: result.member, cell: cell ? svc().toSnapshot(cell) : undefined } };
  });

  registerFetchRoute(router, 'PUT', `${base}/collaboration/cells/:id/members/:endpointId`, async (ctx: RouterContext) => {
    const id = ctx.params.id;
    const endpointId = ctx.params.endpointId;
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const patch = {
      primary: typeof body.primary === 'string' ? body.primary : undefined,
      role: typeof body.role === 'string' ? body.role : undefined,
      pipelineRole: typeof body.pipelineRole === 'string' ? body.pipelineRole : undefined,
      peerSenderId: typeof body.peerSenderId === 'string' ? body.peerSenderId : undefined,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    };
    const result = await svc().updateMember(id, endpointId, patch);
    if (!result.ok) {
      ctx.status = result.error?.includes('not found') ? 404 : 400;
      ctx.body = { success: false, error: result.error };
      return;
    }
    const cell = svc().getCell(id);
    ctx.status = 200;
    ctx.body = { success: true, data: { member: result.member, cell: cell ? svc().toSnapshot(cell) : undefined } };
  });

  registerFetchRoute(router, 'DELETE', `${base}/collaboration/cells/:id/members/:endpointId`, async (ctx: RouterContext) => {
    const id = ctx.params.id;
    const endpointId = ctx.params.endpointId;
    const ok = await svc().removeMember(id, endpointId);
    if (!ok) {
      ctx.status = 404;
      ctx.body = { success: false, error: `Member ${endpointId} not found` };
      return;
    }
    const cell = svc().getCell(id);
    ctx.status = 200;
    ctx.body = { success: true, data: { cell: cell ? svc().toSnapshot(cell) : undefined } };
  });

  // ── Pipeline 状态 + Artifacts（ADR 0024 D4）──────────────────────────

  registerFetchRoute(router, 'GET', `${base}/collaboration/cells/:id/pipeline`, async (ctx: RouterContext) => {
    const id = ctx.params.id;
    const cell = await svc().getCellFresh(id);
    if (!cell) {
      ctx.status = 404;
      ctx.body = { success: false, error: `Cell ${id} not found` };
      return;
    }
    ctx.status = 200;
    ctx.body = { success: true, data: { cellId: id, pipelineState: cell.pipelineState ?? null } };
  });

  registerFetchRoute(router, 'GET', `${base}/collaboration/cells/:id/artifacts`, async (ctx: RouterContext) => {
    const id = ctx.params.id;
    const runId = typeof ctx.query.runId === 'string' ? ctx.query.runId : '';
    const cell = await svc().getCellFresh(id);
    const effectiveRun = runId || cell?.pipelineState?.runId || '';
    if (!effectiveRun) {
      ctx.status = 200;
      ctx.body = { success: true, data: { cellId: id, runId: '', artifacts: [] } };
      return;
    }
    const artifacts = await getCollaborationArtifactRepository().listByRun(id, effectiveRun);
    ctx.status = 200;
    ctx.body = { success: true, data: { cellId: id, runId: effectiveRun, artifacts } };
  });
}
