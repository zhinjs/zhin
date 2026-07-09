import {
  addSkillToSnapshot,
  touchToolsInSnapshot,
  type DeferredToolSessionSnapshot,
} from '@zhin.js/ai';
import { Logger } from '@zhin.js/logger';
import type { ToolCatalogItem } from '../tool-catalog/types.js';
import { resolveDeferredToolsConfig } from '../tool-catalog/resolve-config.js';
import { persistDeferredToolSnapshot } from '../zhin-agent/tool-orchestration.js';
import type { ZhinAgentPrivate } from '../zhin-agent/zhin-agent-private.js';
import { getScheduleTurnContext } from '../zhin-agent/turn-context.js';
import type { ScheduleJobExecutionPlan } from './types.js';

const logger = new Logger(null, 'schedule-tool-runtime');

export async function preloadScheduleTools(
  host: ZhinAgentPrivate,
  sessionId: string,
  executionPlan: ScheduleJobExecutionPlan,
  catalog: ToolCatalogItem[],
  sessionSnapshot: DeferredToolSessionSnapshot,
): Promise<DeferredToolSessionSnapshot> {
  const deferredCfg = resolveDeferredToolsConfig(host.config);
  const catalogNames = new Set(catalog.map((c) => c.name));
  let snapshot = sessionSnapshot;
  let touched = false;

  if (executionPlan.skills?.length && host.skillRegistry) {
    for (const skillName of executionPlan.skills) {
      const skill = host.skillRegistry.getByName(skillName);
      if (!skill) {
        logger.warn(`Schedule execution plan: skill "${skillName}" not found in registry`);
        continue;
      }
      snapshot = addSkillToSnapshot(snapshot, skill.name);
      snapshot = touchToolsInSnapshot(
        snapshot,
        skill.tools.map((t) => t.name),
        deferredCfg.maxLoadedPerSession,
      );
      touched = true;
    }
  }

  if (executionPlan.tools?.length) {
    const validTools: string[] = [];
    for (const name of executionPlan.tools) {
      if (catalogNames.has(name)) {
        validTools.push(name);
      } else {
        logger.warn(`Schedule execution plan: tool "${name}" not in catalog for this turn`);
      }
    }
    if (validTools.length) {
      snapshot = touchToolsInSnapshot(snapshot, validTools, deferredCfg.maxLoadedPerSession);
      touched = true;
    }
  }

  if (touched) {
    await persistDeferredToolSnapshot(host, sessionId, snapshot);
  }
  return snapshot;
}

export async function preloadScheduleToolsFromContext(
  host: ZhinAgentPrivate,
  sessionId: string,
  catalog: ToolCatalogItem[],
  sessionSnapshot: DeferredToolSessionSnapshot,
): Promise<DeferredToolSessionSnapshot> {
  const plan = getScheduleTurnContext()?.executionPlan;
  if (!plan) return sessionSnapshot;
  return preloadScheduleTools(host, sessionId, plan, catalog, sessionSnapshot);
}
