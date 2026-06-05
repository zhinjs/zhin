/**
 * Tool selection — normalization, permission checks, context injection and relevance caching.
 */

import { Logger } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';
import type { AgentTool, ToolFilterOptions } from '@zhin.js/ai';
import { CachedToolFilter } from '@zhin.js/ai';
import type { SkillRegistry } from './skill-registry.js';
import {
  canAccessTool as coreCanAccessTool,
  roleSatisfies,
  resolveRolesFromContext,
} from '@zhin.js/core';
import type { Skill, Tool, ToolContext } from './types.js';
import type { ZhinAgentConfig } from '../zhin-agent/config.js';

const logger = new Logger(null, 'ZhinAgent:ToolSelection');

/** 技能在 frontmatter 中声明了 `platforms` 且包含当前会话平台时，视为「来源平台绑定」，无需用户消息里写出技能名。 */
function skillDeclaresPlatform(skill: { platforms?: string[] }, platform: string | undefined): boolean {
  if (!platform || !skill.platforms?.length) return false;
  const pl = platform.toLowerCase();
  return skill.platforms.some(p => String(p).toLowerCase() === pl);
}

/** 多技能同平台时优先与 adapter 名一致的 `name`（如 platform=github → skill github）。 */
function pickPlatformTriggeredSkillName(skills: Array<{ name: string; platforms?: string[] }>, platform: string | undefined): string | null {
  const matches = skills.filter(s => skillDeclaresPlatform(s, platform));
  if (matches.length === 0) return null;
  const pl = (platform || '').toLowerCase();
  const same = matches.find(s => s.name.toLowerCase() === pl);
  return (same ?? matches[0]).name;
}

/** 在 search 结果后追加「当前平台绑定」且尚未入选的技能，直到达到 maxSkills。 */
function mergeSkillsWithPlatformAffinity(
  searched: Skill[],
  skillRegistry: SkillRegistry,
  platform: string | undefined,
  maxSkills: number,
): Skill[] {
  const out: Skill[] = [];
  const seen = new Set<string>();
  for (const s of searched) {
    if (seen.has(s.name)) continue;
    out.push(s);
    seen.add(s.name);
    if (out.length >= maxSkills) return out;
  }
  for (const skill of skillRegistry.getAll()) {
    if (!skillDeclaresPlatform(skill, platform)) continue;
    if (seen.has(skill.name)) continue;
    out.push(skill);
    seen.add(skill.name);
    if (out.length >= maxSkills) return out;
  }
  return out;
}

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
  'generate_image',
  'analyze_media',
] as const;

export interface RestrictedToolViewOptions {
  allowedNames?: readonly string[];
  disabledNames?: readonly string[];
}

export function canAccessTool(tool: Tool, context: ToolContext): boolean {
  return coreCanAccessTool(tool as import('@zhin.js/core').Tool, context);
}

/** 技能关联工具：跨 IM 平台可用（如 QQ 上 star 仓库），仅校验 scope/权限。 */
export function canAccessToolFromSkill(tool: Tool, context: ToolContext): boolean {
  if (tool.scopes?.length && (!context.scope || !tool.scopes.includes(context.scope))) return false;
  return roleSatisfies(resolveRolesFromContext(context), tool.requiredAnyRole);
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
    || Array.isArray(obj.requiredAnyRole)
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
  if (tool.requiredAnyRole?.length) agentTool.requiredAnyRole = [...tool.requiredAnyRole];
  if (tool.preExecutable) agentTool.preExecutable = true;
  if (tool.kind) agentTool.kind = tool.kind;
  if (tool.source) agentTool.source = tool.source;
  const toolTimeout = (tool as { timeout?: number }).timeout;
  if (toolTimeout != null) agentTool.timeout = toolTimeout;
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
    const collected: AgentTool[] = [];
    const collectedNames = new Set<string>();
    const platformOnlySkillToolNames = new Set<string>();
    const mentionedSkillToolNames = new Set<string>();

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
      if (!mentionedSkill) {
        mentionedSkill = pickPlatformTriggeredSkillName(skillRegistry.getAll(), context.platform);
        if (mentionedSkill) {
          logger.debug(
            `[技能检测] 消息来源平台自动关联技能: ${mentionedSkill} (platform=${context.platform})`,
          );
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
      const skillByName = skillRegistry && typeof skillRegistry.getByName === 'function'
        ? skillRegistry.getByName(mentionedSkill)
        : undefined;
      if (skillByName) {
        for (const tool of skillByName.tools) {
          if (!canAccessToolFromSkill(tool, context)) continue;
          if (collectedNames.has(tool.name)) continue;
          collected.push(this.normalize(tool, context));
          collectedNames.add(tool.name);
          mentionedSkillToolNames.add(tool.name);
        }
        if (mentionedSkillToolNames.size > 0) {
          logger.debug(
            `[技能工具] 已注入 ${mentionedSkill} 的 ${mentionedSkillToolNames.size} 个工具（跨平台）`,
          );
        }
      }
    }

    if (skillRegistry) {
      const searched = skillRegistry.search(message, { maxResults: config.maxSkills, platform: context.platform });
      const fromSearch = new Set(searched.map(s => s.name));
      const skills = mergeSkillsWithPlatformAffinity(searched, skillRegistry, context.platform, config.maxSkills);
      for (const s of skills) {
        if (!fromSearch.has(s.name) && skillDeclaresPlatform(s, context.platform)) {
          for (const t of s.tools) platformOnlySkillToolNames.add(t.name);
        }
      }
      const skillStr = skills.length > 0
        ? skills.map(s => `${s.name}(${s.tools?.length || 0}工具)`).join(', ')
        : '(无匹配技能)';
      logger.debug(`[Skill 匹配] ${skillStr}` + (context.platform ? ` (平台: ${context.platform})` : ''));

      for (const skill of skills) {
        for (const tool of skill.tools) {
          if (!canAccessToolFromSkill(tool, context)) continue;
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
      if (collectedNames.has(tool.name)) continue;
      collected.push(tool);
      collectedNames.add(tool.name);
    }

    const filtered = this.filterByRelevance(message, collected, {
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

    /** 已从候选集加入的 skill 类工具：用户消息可能与其 TF-IDF 词表无交集，但仍须保留 */
    for (const name of ['activate_skill', 'install_skill'] as const) {
      if (filtered.some(t => t.name === name)) continue;
      const t = collected.find(x => x.name === name);
      if (t) filtered.unshift(t);
    }

    /** 仅因「来源平台」合并进来的技能：其工具与用户句可能无语义重叠，仍须保留 */
    for (const name of platformOnlySkillToolNames) {
      if (filtered.some(t => t.name === name)) continue;
      const t = collected.find(x => x.name === name);
      if (t) filtered.unshift(t);
    }

    /** 消息命中技能名/关键词时注入的工具：与 activate_skill 指引一致，须保留 */
    for (const name of mentionedSkillToolNames) {
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
      logger.debug(formatCompact( {
        collected: collected.length,
        filtered: final.length,
        top: final.slice(0, 3).map(t => t.name).join(','),
      }));
    } else {
      logger.debug(formatCompact( { collected: collected.length, filtered: 0 }));
    }

    return final;
  }
}

export const sharedToolSelection = new ToolSelection();

