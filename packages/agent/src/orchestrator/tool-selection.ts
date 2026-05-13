/**
 * Tool selection — normalization, permission checks, context injection and relevance caching.
 */

import { Logger } from '@zhin.js/core';
import type { AgentTool, ToolFilterOptions } from '@zhin.js/ai';
import { CachedToolFilter } from '@zhin.js/ai';
import type { SkillRegistry } from './skill-registry.js';
import type { Tool, ToolContext, ToolPermissionLevel } from './types.js';
import type { ZhinAgentConfig } from '../zhin-agent/config.js';

const logger = new Logger(null, 'ZhinAgent:ToolSelection');

export const PERMISSION_LEVEL_PRIORITY: Record<ToolPermissionLevel, number> = {
  user: 0,
  group_admin: 1,
  group_owner: 2,
  bot_admin: 3,
  owner: 4,
};

export type ToolLike = {
  toTool(): Tool;
};

export type NormalizableTool = Tool | AgentTool | ToolLike;

export interface CollectToolsContext {
  config: Required<ZhinAgentConfig>;
  skillRegistry: SkillRegistry | null;
  externalRegistered: Map<string, AgentTool>;
}

export const DEFAULT_SUBAGENT_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'glob',
  'grep',
  'bash',
  'web_search',
  'web_fetch',
] as const;

export interface RestrictedToolViewOptions {
  allowedNames?: readonly string[];
  disabledNames?: readonly string[];
}

export function permissionLevelToPriority(level: ToolPermissionLevel | string | undefined): number {
  if (!level) return 0;
  return PERMISSION_LEVEL_PRIORITY[level as ToolPermissionLevel] ?? 0;
}

export function hasPermissionLevel(userLevel: ToolPermissionLevel, requiredLevel: ToolPermissionLevel): boolean {
  return permissionLevelToPriority(userLevel) >= permissionLevelToPriority(requiredLevel);
}

export function inferPermissionLevel(context: ToolContext): ToolPermissionLevel {
  if (context.senderPermissionLevel) return context.senderPermissionLevel;
  if (context.isOwner) return 'owner';
  if (context.isBotAdmin) return 'bot_admin';
  if (context.isGroupOwner) return 'group_owner';
  if (context.isGroupAdmin) return 'group_admin';
  return 'user';
}

export function inferPermissionPriority(context: ToolContext): number {
  return permissionLevelToPriority(inferPermissionLevel(context));
}

export function canAccessTool(tool: Tool, context: ToolContext): boolean {
  if (tool.platforms?.length && (!context.platform || !tool.platforms.includes(context.platform))) return false;
  if (tool.scopes?.length && (!context.scope || !tool.scopes.includes(context.scope))) return false;
  return hasPermissionLevel(inferPermissionLevel(context), tool.permissionLevel || 'user');
}

export function createRestrictedToolView(
  tools: AgentTool[],
  options: RestrictedToolViewOptions = {},
): AgentTool[] {
  const allowed = new Set((options.allowedNames ?? DEFAULT_SUBAGENT_TOOL_NAMES).map(name => name.toLowerCase()));
  const disabled = new Set((options.disabledNames ?? []).map(name => name.toLowerCase()));
  const selected: AgentTool[] = [];
  const seen = new Set<string>();

  for (const tool of tools) {
    const key = tool.name.toLowerCase();
    if (!allowed.has(key) || disabled.has(key) || seen.has(key)) continue;
    selected.push(tool);
    seen.add(key);
  }

  return selected;
}

function isToolLike(input: unknown): input is ToolLike {
  return !!input && typeof (input as ToolLike).toTool === 'function';
}

function hasToolShape(input: unknown): input is Tool {
  const obj = input as Partial<Tool> | undefined;
  return !!obj
    && typeof obj.name === 'string'
    && typeof obj.description === 'string'
    && typeof obj.execute === 'function'
    && !!obj.parameters;
}

function isIMTool(input: unknown): input is Tool {
  if (!hasToolShape(input)) return false;
  const obj = input as Partial<Tool>;
  return 'platforms' in obj
    || 'scopes' in obj
    || typeof obj.permissionLevel === 'string'
    || 'permissions' in obj
    || 'hidden' in obj
    || 'source' in obj;
}

function stripContextParameters(tool: Tool, context?: ToolContext): {
  parameters: AgentTool['parameters'];
  injections: Array<{ paramName: string; contextKey: string; paramType: string }>;
} {
  const injections: Array<{ paramName: string; contextKey: string; paramType: string }> = [];
  let parameters: AgentTool['parameters'] = tool.parameters;

  if (!context || !tool.parameters?.properties) {
    return { parameters, injections };
  }

  const props = tool.parameters.properties as Record<string, any>;
  const filteredProps: Record<string, any> = {};
  const filteredRequired: string[] = [];

  for (const [key, schema] of Object.entries(props)) {
    if (schema.contextKey && (context as Record<string, unknown>)[schema.contextKey] != null) {
      injections.push({
        paramName: key,
        contextKey: schema.contextKey,
        paramType: schema.type || 'string',
      });
      continue;
    }
    filteredProps[key] = schema;
    if (tool.parameters.required?.includes(key)) {
      filteredRequired.push(key);
    }
  }

  if (injections.length > 0) {
    parameters = {
      ...tool.parameters,
      properties: filteredProps,
      required: filteredRequired.length > 0 ? filteredRequired : undefined,
    };
  }

  return { parameters, injections };
}

export function normalizeTool(input: NormalizableTool, context?: ToolContext): AgentTool {
  if (isToolLike(input)) {
    return normalizeTool(input.toTool(), context);
  }

  if (!isIMTool(input) && !(context && hasToolShape(input))) {
    return input as AgentTool;
  }

  const tool = input;
  const originalExecute = tool.execute;
  const { parameters, injections } = stripContextParameters(tool, context);

  const agentTool: AgentTool = {
    name: tool.name,
    description: tool.description,
    parameters,
    execute: context
      ? async (args: Record<string, any>) => {
          const enrichedArgs = { ...args };
          for (const { paramName, contextKey, paramType } of injections) {
            let value = (context as Record<string, unknown>)[contextKey];
            if (paramType === 'number' && typeof value === 'string') {
              value = Number(value);
            } else if (paramType === 'string' && typeof value !== 'string') {
              value = String(value);
            }
            enrichedArgs[paramName] = value;
          }
          return originalExecute(enrichedArgs, context);
        }
      : async (args: Record<string, any>) => originalExecute(args),
  };

  if (tool.tags?.length) agentTool.tags = tool.tags;
  if (tool.keywords?.length) agentTool.keywords = tool.keywords;
  if (tool.permissionLevel) agentTool.permissionLevel = permissionLevelToPriority(tool.permissionLevel);
  if (tool.preExecutable) agentTool.preExecutable = true;
  if (tool.kind) agentTool.kind = tool.kind;
  if (tool.source) agentTool.source = tool.source;
  return agentTool;
}

export class ToolSelection {
  private readonly cachedFilter = new CachedToolFilter();

  normalize(input: NormalizableTool, context?: ToolContext): AgentTool {
    return normalizeTool(input, context);
  }

  filterByRelevance(message: string, tools: AgentTool[], options?: ToolFilterOptions): AgentTool[] {
    return this.cachedFilter.filter(message, tools, options);
  }

  invalidate(): void {
    this.cachedFilter.invalidate();
  }

  get cacheSize(): number {
    return this.cachedFilter.size;
  }

  collectRelevantTools(
    message: string,
    context: ToolContext,
    externalTools: Tool[],
    ctx: CollectToolsContext,
  ): AgentTool[] {
    const { config, skillRegistry, externalRegistered } = ctx;
    const callerPerm = inferPermissionPriority(context);
    const collected: AgentTool[] = [];
    const collectedNames = new Set<string>();

    let mentionedSkill: string | null = null;
    if (skillRegistry && skillRegistry.size > 0) {
      const msgLower = message.toLowerCase();
      outer: for (const skill of skillRegistry.getAll()) {
        if (msgLower.includes(skill.name.toLowerCase())) {
          mentionedSkill = skill.name;
          logger.debug(`[技能检测] 用户提到技能(名称): ${mentionedSkill}`);
          break;
        }
        for (const kw of skill.keywords || []) {
          if (kw && msgLower.includes(String(kw).toLowerCase())) {
            mentionedSkill = skill.name;
            logger.debug(`[技能检测] 用户提到技能(关键词→${skill.name}): ${kw}`);
            break outer;
          }
        }
      }
    }

    if (mentionedSkill) {
      const activateSkillTool = externalTools.find(t => t.name === 'activate_skill');
      if (activateSkillTool && canAccessTool(activateSkillTool, context)) {
        collected.push(this.normalize(activateSkillTool, context));
        collectedNames.add('activate_skill');
        logger.debug(`[技能激活] 已提前加入 activate_skill 工具（优先级最高）`);
      }
    }

    if (skillRegistry) {
      const skills = skillRegistry.search(message, { maxResults: config.maxSkills, platform: context.platform });
      const skillStr = skills.length > 0
        ? skills.map(s => `${s.name}(${s.tools?.length || 0}工具)`).join(', ')
        : '(无匹配技能)';
      logger.debug(`[Skill 匹配] ${skillStr}` + (context.platform ? ` (平台: ${context.platform})` : ''));

      for (const skill of skills) {
        for (const tool of skill.tools) {
          if (!canAccessTool(tool, context)) continue;
          if (collectedNames.has(tool.name)) continue;
          collected.push(this.normalize(tool, context));
          collectedNames.add(tool.name);
        }
      }
    }

    let deduped = 0;
    for (const tool of externalTools) {
      if (!canAccessTool(tool, context)) continue;
      if (collectedNames.has(tool.name)) {
        deduped++;
        continue;
      }
      collected.push(this.normalize(tool, context));
      collectedNames.add(tool.name);
    }
    if (deduped > 0) {
      logger.debug(`externalTools 去重: 跳过 ${deduped} 个已由 Skill 提供的工具`);
    }

    for (const tool of externalRegistered.values()) {
      if (tool.permissionLevel != null && tool.permissionLevel > callerPerm) continue;
      if (collectedNames.has(tool.name)) continue;
      collected.push(tool);
      collectedNames.add(tool.name);
    }

    const filtered = this.filterByRelevance(message, collected, {
      callerPermissionLevel: callerPerm,
      maxTools: config.maxTools,
      minScore: 0.3,
    });

    /** 时事/实体类问题常无关键词命中；以下工具仍应留在候选集中供模型自行调用 */
    const relevanceResidentNames = ['web_search', 'ask_user'] as const;
    for (const name of relevanceResidentNames) {
      if (filtered.some(t => t.name === name)) continue;
      const t = collected.find(x => x.name === name);
      if (t) filtered.unshift(t);
    }

    if (mentionedSkill && filtered.length > 0) {
      const activateSkillIdx = filtered.findIndex(t => t.name === 'activate_skill');
      if (activateSkillIdx > 0) {
        const activateSkillTool = filtered[activateSkillIdx];
        filtered.splice(activateSkillIdx, 1);
        filtered.unshift(activateSkillTool);
        logger.debug(`[工具排序] activate_skill 提升至首位（因检测到技能: ${mentionedSkill}）`);
      }
    }

    const skillSupportTools = ['bash', 'web_fetch', 'web_search', 'write_file', 'read_file'];
    const hasSkillTool = filtered.some(t => t.name === 'activate_skill' || t.name === 'install_skill');
    if (hasSkillTool) {
      const filteredNames = new Set(filtered.map(t => t.name));
      for (const supportName of skillSupportTools) {
        if (filteredNames.has(supportName)) continue;
        const supportTool = collected.find(t => t.name === supportName);
        if (supportTool) {
          filtered.push(supportTool);
          filteredNames.add(supportName);
        }
      }
      logger.debug(`[技能支持] 已补充工具: ${skillSupportTools.filter(n => filteredNames.has(n)).join(', ')}`);
    }

    let final = filtered;
    const allowed = config.allowedTools;
    const disabled = config.disabledTools ?? [];
    if (allowed && allowed.length > 0) {
      const allowSet = new Set(allowed.map(n => n.toLowerCase()));
      final = final.filter(t => allowSet.has(t.name.toLowerCase()));
      if (final.length < filtered.length) {
        logger.debug(`[工具开关] allowedTools 限制: ${filtered.length} -> ${final.length}`);
      }
    } else if (disabled.length > 0) {
      const disabledSet = new Set(disabled.map(n => n.toLowerCase()));
      final = final.filter(t => !disabledSet.has(t.name.toLowerCase()));
      if (final.length < filtered.length) {
        logger.debug(`[工具开关] disabledTools 过滤: ${filtered.length} -> ${final.length}`);
      }
    }

    if (final.length > 0) {
      logger.debug(
        `[工具收集] 收集了 ${collected.length} 个工具，过滤后 ${final.length} 个，` +
        `用户消息相关性最高的: ${final.slice(0, 3).map(t => t.name).join(', ')}`
      );
    } else {
      logger.debug(`[工具收集] 收集了 ${collected.length} 个工具，但过滤后 0 个（没有超过相关性阈值的）`);
    }

    return final;
  }
}

export const sharedToolSelection = new ToolSelection();

