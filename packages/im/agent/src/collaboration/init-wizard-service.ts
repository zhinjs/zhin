/**
 * InitWizardService — 程序化向导状态机。
 *
 * 流程（两阶段）：
 * 1. 收集阶段：/collab init @Planner → prompt 逐步 @ 各角色 → 各 bot stash observation
 * 2. 提交阶段：/collab inited @Planner → 汇聚 stash → 一次性创建 Cell
 */

import type { CollaborationScene, PipelineRole } from './types.js';
import { randomUUID } from 'node:crypto';
import { WIZARD_STEPS, isAssignableWizardRole, type WizardStep, type AssignableWizardRole } from './collaboration-db-model.js';
import { getSceneIdentityService, type InitSessionRecord } from './scene-identity-service.js';
import { getCollaborationSceneService } from './scene-service.js';
import { rebootstrapEndpointRuntimes } from './bootstrap-agent-runtimes.js';
import { defaultCellId } from './collaboration-commands.js';

const WIZARD_PROMPTS: Record<WizardStep, string> = {
  researcher: '协作群初始化：请 @ 调研员（Researcher）Bot',
  evaluator: '请 @ 评估员（Evaluator）Bot',
  executor: '请 @ 执行员（Executor）Bot',
  reviewer: '请 @ 评审员（Reviewer）Bot',
  done: '角色选完后请发送 /collab inited @我',
};

const ASSIGNABLE_STEPS: AssignableWizardRole[] = ['researcher', 'evaluator', 'executor', 'reviewer'];

function nextWizardStep(current: WizardStep): WizardStep {
  if (!isAssignableWizardRole(current)) return 'done';
  const idx = ASSIGNABLE_STEPS.indexOf(current);
  if (idx < 0 || idx >= ASSIGNABLE_STEPS.length - 1) return 'done';
  return ASSIGNABLE_STEPS[idx + 1]!;
}

export function getWizardPrompt(step: WizardStep): string {
  return WIZARD_PROMPTS[step] ?? WIZARD_PROMPTS.done;
}

export interface StartWizardInput {
  plannerEndpointId: string;
  plannerAdapter: string;
  plannerSceneId: string;
}

export interface StartWizardResult {
  ok: boolean;
  sessionId?: string;
  prompt?: string;
  error?: string;
}

/**
 * 启动 init 向导：创建 init_session，返回第一步提问。
 */
export async function startInitWizard(input: StartWizardInput): Promise<StartWizardResult> {
  const svc = getSceneIdentityService();

  const existing = await svc.getActiveInitSession(
    input.plannerAdapter,
    input.plannerSceneId,
  );
  if (existing) {
    const step = (existing.wizardStep || 'researcher') as WizardStep;
    return {
      ok: true,
      sessionId: existing.id,
      prompt: `⚠️ 已有进行中的 init 向导（步骤：${step}）。\n${getWizardPrompt(step)}\n如需重来请先 /collab init-cancel`,
    };
  }

  const sessionId = `init-${Date.now().toString(36)}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const logicalSceneId = defaultCellId(input.plannerAdapter, input.plannerSceneId);

  await svc.createInitSession({
    id: sessionId,
    logicalSceneId,
    plannerEndpointId: input.plannerEndpointId,
    plannerAdapter: input.plannerAdapter,
    plannerSceneId: input.plannerSceneId,
  });

  const firstStep: WizardStep = 'researcher';
  return {
    ok: true,
    sessionId,
    prompt: getWizardPrompt(firstStep),
  };
}

/**
 * 向导步骤推进：master @ 到某 bot → 记录 observation → CAS 推进一步。
 */
export async function advanceWizardStep(
  session: InitSessionRecord,
  expectedStep?: WizardStep,
): Promise<{ nextPrompt: string; done: boolean; advanced: boolean }> {
  const current = (session.wizardStep || 'researcher') as WizardStep;
  if (expectedStep && expectedStep !== current) {
    return {
      nextPrompt: getWizardPrompt(current),
      done: current === 'done',
      advanced: false,
    };
  }

  const next = nextWizardStep(current);
  const svc = getSceneIdentityService();
  const ok = await svc.advanceInitSessionStepIf(session.id, current, next);
  if (!ok) {
    const fresh = (await svc.getInitSession(session.id)) ?? session;
    const step = (fresh.wizardStep || current) as WizardStep;
    return {
      nextPrompt: getWizardPrompt(step),
      done: step === 'done',
      advanced: false,
    };
  }

  if (next === 'done') {
    return {
      nextPrompt: getWizardPrompt('done'),
      done: true,
      advanced: true,
    };
  }

  return {
    nextPrompt: getWizardPrompt(next),
    done: false,
    advanced: true,
  };
}

export interface AggregateResult {
  ok: boolean;
  scene?: CollaborationScene;
  warnings: string[];
  sceneCount: number;
  memberCount: number;
  channelCount: number;
}

/**
 * /collab inited — Planner 汇聚 stash → 一次性创建协作群（Cell + alias + channels）。
 */
export async function aggregateAndActivate(
  session: InitSessionRecord,
  registeredEndpoints: Map<string, { adapter: string; endpointId: string }>,
  plannerPrimary: string,
): Promise<AggregateResult> {
  const sceneSvc = getSceneIdentityService();
  const cellSvc = getCollaborationSceneService();
  const warnings: string[] = [];

  await sceneSvc.updateInitSessionStatus(session.id, 'aggregating');

  const logicalSceneId = session.logicalSceneId || defaultCellId(session.plannerAdapter, session.plannerSceneId);

  const observations = await sceneSvc.listObservations(session.id);
  const plan = sceneSvc.planInitFromObservations(
    logicalSceneId,
    observations,
    registeredEndpoints,
    { plannerEndpointId: session.plannerEndpointId },
  );

  const plannerSceneAlias = {
    logicalSceneId,
    adapter: session.plannerAdapter,
    sceneId: session.plannerSceneId,
  };
  const sceneAliasDedup = new Map<string, typeof plannerSceneAlias>();
  sceneAliasDedup.set(`${plannerSceneAlias.adapter}:${plannerSceneAlias.sceneId}`, plannerSceneAlias);
  for (const alias of plan.sceneAliases) {
    sceneAliasDedup.set(`${alias.adapter}:${alias.sceneId}`, alias);
  }

  const plannerChannels = [...sceneAliasDedup.values()].map((alias) => ({
    logicalSceneId,
    endpointId: session.plannerEndpointId,
    pipelineRole: 'planner',
    adapter: alias.adapter,
    sceneId: alias.sceneId,
    botId: session.plannerEndpointId,
  }));
  const allChannels = [...plannerChannels, ...plan.channels];

  await sceneSvc.commitInitPlan({
    logicalSceneId,
    sceneAliases: [...sceneAliasDedup.values()],
    channels: allChannels,
  });

  const memberInputs = [
    {
      endpointId: session.plannerEndpointId,
      primary: plannerPrimary || 'planner',
      pipelineRole: 'planner' as PipelineRole,
      adapter: session.plannerAdapter,
    },
    ...plan.members.map((m) => ({
      endpointId: m.endpointId,
      primary: m.pipelineRole,
      pipelineRole: m.pipelineRole as PipelineRole,
      adapter: m.adapter,
    })),
  ];

  const deduped = new Map<string, (typeof memberInputs)[number]>();
  for (const m of memberInputs) {
    if (!deduped.has(m.endpointId)) {
      deduped.set(m.endpointId, m);
    }
  }

  const missingRoles = ASSIGNABLE_STEPS.filter(
    (role) => ![...deduped.values()].some((m) => m.pipelineRole === role),
  );
  if (missingRoles.length > 0) {
    warnings.push(`缺少角色：${missingRoles.join(', ')}（可稍后用 /collab bind 补充）`);
  }

  const cell = await cellSvc.upsertScene({
    id: logicalSceneId,
    adapter: session.plannerAdapter,
    sceneId: session.plannerSceneId,
    goal: '多 Agent 协作群',
    members: [...deduped.values()],
  });

  await sceneSvc.updateInitSessionStatus(session.id, 'active', logicalSceneId);
  await rebootstrapEndpointRuntimes();

  return {
    ok: true,
    scene: cell,
    warnings,
    sceneCount: sceneAliasDedup.size,
    memberCount: deduped.size,
    channelCount: allChannels.length,
  };
}

/**
 * 取消进行中的 init 向导。
 */
export async function cancelInitWizard(
  adapter: string,
  sceneId: string,
): Promise<{ ok: boolean; error?: string }> {
  const svc = getSceneIdentityService();
  const session = await svc.getActiveInitSession(adapter, sceneId);
  if (!session) {
    return { ok: false, error: '当前群没有进行中的 init 向导。' };
  }
  await svc.updateInitSessionStatus(session.id, 'cancelled');
  return { ok: true };
}
