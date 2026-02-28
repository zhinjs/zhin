/**
 * ZhinAgent 工具收集 — 两级过滤 (Skill → Tool) + 技能支持工具注入
 */

import { Logger } from '@zhin.js/logger';
import type { Tool, ToolContext } from '../../types.js';
import type { SkillFeature } from '../../built/skill.js';
import type { AgentTool } from '../types.js';
import { Agent } from '../agent.js';
import type { ZhinAgentConfig } from './config.js';
import { PERM_MAP } from './config.js';

const logger = new Logger(null, 'ZhinAgent:ToolCollector');

/**
 * Convert a Tool (with ToolContext) to an AgentTool, injecting context-provided parameters.
 */
export function toAgentTool(tool: Tool, context?: ToolContext): AgentTool {
  const originalExecute = tool.execute;

  const contextInjections: Array<{
    paramName: string;
    contextKey: string;
    paramType: string;
  }> = [];
  let cleanParameters: any = tool.parameters;

  if (context && tool.parameters?.properties) {
    const props = tool.parameters.properties as Record<string, any>;
    const filteredProps: Record<string, any> = {};
    const filteredRequired: string[] = [];

    for (const [key, schema] of Object.entries(props)) {
      if (schema.contextKey && (context as any)[schema.contextKey] != null) {
        contextInjections.push({
          paramName: key,
          contextKey: schema.contextKey,
          paramType: schema.type || 'string',
        });
      } else {
        filteredProps[key] = schema;
        if (tool.parameters.required?.includes(key)) {
          filteredRequired.push(key);
        }
      }
    }

    if (contextInjections.length > 0) {
      cleanParameters = {
        ...tool.parameters,
        properties: filteredProps,
        required: filteredRequired.length > 0 ? filteredRequired : undefined,
      };
    }
  }

  const at: AgentTool = {
    name: tool.name,
    description: tool.description,
    parameters: cleanParameters as any,
    execute: context
      ? (args: Record<string, any>) => {
          const enrichedArgs = { ...args };
          for (const { paramName, contextKey, paramType } of contextInjections) {
            let value = (context as any)[contextKey];
            if (paramType === 'number' && typeof value === 'string') {
              value = Number(value);
            } else if (paramType === 'string' && typeof value !== 'string') {
              value = String(value);
            }
            enrichedArgs[paramName] = value;
          }
          return originalExecute(enrichedArgs, context);
        }
      : originalExecute,
  };
  if (tool.tags?.length) at.tags = tool.tags;
  if (tool.keywords?.length) at.keywords = tool.keywords;
  if (tool.permissionLevel) at.permissionLevel = PERM_MAP[tool.permissionLevel] ?? 0;
  if (tool.preExecutable) at.preExecutable = true;
  if ((tool as any).kind) at.kind = (tool as any).kind;
  return at;
}

export interface CollectToolsContext {
  config: Required<ZhinAgentConfig>;
  skillRegistry: SkillFeature | null;
  externalRegistered: Map<string, AgentTool>;
}

/**
 * Two-level tool collection: Skill → Tool filtering, dedup, relevance ranking,
 * skill-support injection, and config-level allow/deny.
 */
export function collectRelevantTools(
  message: string,
  context: ToolContext,
  externalTools: Tool[],
  ctx: CollectToolsContext,
): AgentTool[] {
  const { config, skillRegistry, externalRegistered } = ctx;

  const callerPerm = context.senderPermissionLevel
    ? (PERM_MAP[context.senderPermissionLevel] ?? 0)
    : (context.isOwner ? 4 : context.isBotAdmin ? 3 : context.isGroupOwner ? 2 : context.isGroupAdmin ? 1 : 0);

  const collected: AgentTool[] = [];
  const collectedNames = new Set<string>();

  // 0. Detect if user mentions a known skill name
  let mentionedSkill: string | null = null;
  if (skillRegistry && skillRegistry.size > 0) {
    const msgLower = message.toLowerCase();
    for (const skill of skillRegistry.getAll()) {
      if (msgLower.includes(skill.name.toLowerCase())) {
        mentionedSkill = skill.name;
        logger.debug(`[技能检测] 用户提到技能: ${mentionedSkill}`);
        break;
      }
    }
  }

  if (mentionedSkill) {
    const activateSkillTool = externalTools.find(t => t.name === 'activate_skill');
    if (activateSkillTool) {
      const toolPerm = activateSkillTool.permissionLevel ? (PERM_MAP[activateSkillTool.permissionLevel] ?? 0) : 0;
      if (toolPerm <= callerPerm) {
        collected.push(toAgentTool(activateSkillTool, context));
        collectedNames.add('activate_skill');
        logger.debug(`[技能激活] 已提前加入 activate_skill 工具（优先级最高）`);
      }
    }
  }

  // 1. SkillRegistry two-level filter
  if (skillRegistry) {
    const skills = skillRegistry.search(message, { maxResults: config.maxSkills });
    const skillStr = skills.length > 0
      ? skills.map(s => `${s.name}(${s.tools?.length || 0}工具)`).join(', ')
      : '(无匹配技能)';
    logger.debug(`[Skill 匹配] ${skillStr}`);

    for (const skill of skills) {
      for (const tool of skill.tools) {
        if (tool.platforms?.length && context.platform && !tool.platforms.includes(context.platform)) continue;
        if (tool.scopes?.length && context.scope && !tool.scopes.includes(context.scope)) continue;
        const toolPerm = tool.permissionLevel ? (PERM_MAP[tool.permissionLevel] ?? 0) : 0;
        if (toolPerm > callerPerm) continue;
        if (collectedNames.has(tool.name)) continue;
        collected.push(toAgentTool(tool, context));
        collectedNames.add(tool.name);
      }
    }
  }

  // 2. External tools
  let deduped = 0;
  for (const tool of externalTools) {
    if (tool.name.startsWith('cmd_') || tool.name.startsWith('process_')) continue;
    const toolPerm = tool.permissionLevel ? (PERM_MAP[tool.permissionLevel] ?? 0) : 0;
    if (toolPerm > callerPerm) continue;
    if (collectedNames.has(tool.name)) {
      deduped++;
      continue;
    }
    collected.push(toAgentTool(tool, context));
    collectedNames.add(tool.name);
  }
  if (deduped > 0) {
    logger.debug(`externalTools 去重: 跳过 ${deduped} 个已由 Skill 提供的工具`);
  }

  // 3. Externally registered tools
  for (const tool of externalRegistered.values()) {
    if (tool.permissionLevel != null && tool.permissionLevel > callerPerm) continue;
    if (collectedNames.has(tool.name)) continue;
    collected.push(tool);
    collectedNames.add(tool.name);
  }

  // 4. Relevance filtering
  const filtered = Agent.filterTools(message, collected, {
    callerPermissionLevel: callerPerm,
    maxTools: config.maxTools,
    minScore: 0.3,
  });

  // Prioritize activate_skill when a skill name was detected
  if (mentionedSkill && filtered.length > 0) {
    const activateSkillIdx = filtered.findIndex(t => t.name === 'activate_skill');
    if (activateSkillIdx > 0) {
      const activateSkillTool = filtered[activateSkillIdx];
      filtered.splice(activateSkillIdx, 1);
      filtered.unshift(activateSkillTool);
      logger.debug(`[工具排序] activate_skill 提升至首位（因检测到技能: ${mentionedSkill}）`);
    }
  }

  // Skill support tools injection
  const SKILL_SUPPORT_TOOLS = ['bash', 'web_fetch', 'web_search', 'write_file', 'read_file'];
  const hasSkillTool = filtered.some(t => t.name === 'activate_skill' || t.name === 'install_skill');
  if (hasSkillTool) {
    const filteredNames = new Set(filtered.map(t => t.name));
    for (const supportName of SKILL_SUPPORT_TOOLS) {
      if (filteredNames.has(supportName)) continue;
      const supportTool = collected.find(t => t.name === supportName);
      if (supportTool) {
        filtered.push(supportTool);
        filteredNames.add(supportName);
      }
    }
    logger.debug(`[技能支持] 已补充工具: ${SKILL_SUPPORT_TOOLS.filter(n => filteredNames.has(n)).join(', ')}`);
  }

  // 5. Config-level allow/deny
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
