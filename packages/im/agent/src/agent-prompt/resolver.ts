import { Logger } from '@zhin.js/core';
import type { AgentPromptBuildContext, AgentPromptSection } from '@zhin.js/core';
import type { AgentTool } from '@zhin.js/ai';
import type { ZhinAgentConfig } from '../zhin-agent/config.js';
import { DEFAULT_CONFIG } from '../zhin-agent/config.js';
import { createAIHookEvent, triggerAIHook } from '../hooks.js';
import { getHostRootPlugin } from '@zhin.js/core';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import {
  applyAgentPromptLimits,
  formatAgentPromptSectionsMarkdown,
  sortAgentPromptSections,
} from './format.js';
import { getAgentPromptContributor } from './registry.js';

const logger = new Logger(null, 'AgentPromptResolver');

export interface ResolveAgentPromptOptions {
  ctx: AgentPromptBuildContext;
  config?: Pick<
    Required<ZhinAgentConfig>,
    'platformPromptSectionMaxChars' | 'platformPromptMaxChars'
  >;
  sessionId?: string;
}

export async function resolveAgentPromptSections(
  options: ResolveAgentPromptOptions,
): Promise<AgentPromptSection[]> {
  const { ctx, sessionId } = options;
  const limits = {
    sectionMax: options.config?.platformPromptSectionMaxChars
      ?? DEFAULT_CONFIG.platformPromptSectionMaxChars,
    totalMax: options.config?.platformPromptMaxChars
      ?? DEFAULT_CONFIG.platformPromptMaxChars,
  };

  const platform = String(ctx.commMessage.$adapter);
  const contributor = getAgentPromptContributor(platform);
  let sections: AgentPromptSection[] = [];

  if (contributor) {
    try {
      const built = await contributor.buildSections(ctx);
      if (built?.length) {
        sections.push(...built);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`AgentPromptContributor [${platform}] buildSections failed: ${msg}`);
    }
  }

  sections = sortAgentPromptSections(sections);

  const hookEvent = createAIHookEvent('agent', 'prompt', sessionId, {
    slot: ctx.slot,
    commMessage: ctx.commMessage,
    userMessagePreview: ctx.userMessagePreview,
    deferred: ctx.deferred,
    sections,
  });
  await triggerAIHook(hookEvent);
  const orchestrator = getHostRootPlugin()?.inject?.('agent') as AgentOrchestrator | undefined;
  await orchestrator?.hooks.trigger(hookEvent);
  const hookSections = hookEvent.context.sections;
  if (Array.isArray(hookSections)) {
    sections = sortAgentPromptSections(hookSections as AgentPromptSection[]);
  }

  return applyAgentPromptLimits(sections, limits.sectionMax, limits.totalMax);
}

export async function resolveAgentPromptMarkdown(
  options: ResolveAgentPromptOptions,
): Promise<string> {
  const sections = await resolveAgentPromptSections(options);
  return formatAgentPromptSectionsMarkdown(sections);
}

export function resolveDeferredToolsForPlatform(
  ctx: AgentPromptBuildContext,
  query: string,
  goal: string,
  catalog: AgentTool[],
  maxTools: number,
  defaultSelect: (
    query: string,
    goal: string,
    catalog: AgentTool[],
    maxTools: number,
  ) => AgentTool[],
): AgentTool[] {
  const contributor = getAgentPromptContributor(String(ctx.commMessage.$adapter));
  if (contributor?.matchesDeferredTask?.(ctx)) {
    const catalogLite = catalog.map((t) => ({ name: t.name, description: t.description }));
    const selected = contributor.selectDeferredTools?.(query, goal, catalogLite, maxTools);
    if (selected) {
      const byName = new Map(catalog.map((t) => [t.name, t]));
      return selected
        .map((item) => byName.get(item.name))
        .filter((tool): tool is AgentTool => tool != null);
    }
  }
  return defaultSelect(query, goal, catalog, maxTools);
}

export function platformMatchesDeferredTask(
  ctx: AgentPromptBuildContext,
  query: string,
  goal: string,
): boolean {
  const contributor = getAgentPromptContributor(String(ctx.commMessage.$adapter));
  if (contributor?.matchesDeferredTask) {
    try {
      return contributor.matchesDeferredTask(ctx);
    } catch {
      return false;
    }
  }
  return false;
}
