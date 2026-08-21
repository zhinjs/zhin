import { isSdkId } from '@zhin.js/ai';
import { normalizeMatchRules } from '../routing/match-rules.js';
import type { WorkroomDefinition } from '../workroom/catalog-definition.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './types.js';
import type { NormalizedAiRoutingConfig } from './normalize-ai-config.js';

export function validateAiRoutingConfig(cfg: NormalizedAiRoutingConfig): string[] {
  const errors: string[] = [];
  const configuredMcp = new Set(cfg.mcpServerNames);
  if (configuredMcp.size !== cfg.mcpServerNames.length) {
    errors.push('ai.mcpServers: duplicate server name');
  }

  for (const [alias, prov] of Object.entries(cfg.providers)) {
    if (!prov.sdk?.trim()) {
      errors.push(`ai.providers.${alias}: sdk is required`);
    } else if (!isSdkId(prov.sdk.trim())) {
      errors.push(
        `ai.providers.${alias}: invalid sdk "${prov.sdk}" (openai | anthropic | google | deepseek | ollama | openai-compatible)`,
      );
    }
    if (prov.sdk === 'openai-compatible' && !prov.baseUrl?.trim() && !prov.accountId?.trim()) {
      errors.push(`ai.providers.${alias}: openai-compatible requires baseUrl or accountId`);
    }
    if (prov.sdk === 'ollama' && !prov.host?.trim() && !prov.baseUrl?.trim()) {
      errors.push(`ai.providers.${alias}: ollama requires host or baseUrl`);
    }
  }

  if (!cfg.agents[DEFAULT_ZHIN_AGENT_NAME]) {
    errors.push(`ai.agents.${DEFAULT_ZHIN_AGENT_NAME} is required`);
  }

  for (const [name, binding] of Object.entries(cfg.agents)) {
    if (!cfg.providers[binding.provider]) {
      errors.push(`ai.agents.${name}: unknown provider "${binding.provider}"`);
    }
    if (!binding.model?.trim() && name !== DEFAULT_ZHIN_AGENT_NAME) {
      errors.push(`ai.agents.${name}: model is required`);
    }
    for (const srv of binding.mcpServers ?? []) {
      if (!srv?.trim()) errors.push(`ai.agents.${name}: empty mcpServers entry`);
      else if (srv !== srv.trim()) {
        errors.push(`ai.agents.${name}: MCP server names must not contain surrounding whitespace`);
      } else if (!configuredMcp.has(srv.trim())) {
        errors.push(`ai.agents.${name}: unknown MCP server "${srv}"`);
      }
    }

    const matchRules = normalizeMatchRules(binding.match);
    const hasMatch = matchRules.length > 0;
    const hasPriority = binding.priority != null;

    if (name === DEFAULT_ZHIN_AGENT_NAME) {
      if (hasMatch || hasPriority) {
        errors.push(`ai.agents.${DEFAULT_ZHIN_AGENT_NAME}: must not set priority or match (use implicit fallback)`);
      }
      continue;
    }

    if (binding.match != null && !hasMatch) {
      errors.push(`ai.agents.${name}: match has no routable constraints (need adapter/endpoint/scene/sceneId/hasMedia/contentContains)`);
    }

    if (hasMatch && typeof binding.priority !== 'number') {
      errors.push(`ai.agents.${name}: priority is required when match is set`);
    }
    if (hasPriority && !hasMatch) {
      errors.push(`ai.agents.${name}: match is required when priority is set`);
    }
  }

  return errors;
}

const WORKROOM_ROLES = new Set(['orchestrator', 'executor', 'reviewer', 'integration']);

export function validateWorkroomDefinitions(
  rawWorkrooms: unknown,
  agentNames: readonly string[],
  endpointKeys?: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  if (rawWorkrooms == null) return errors;
  if (typeof rawWorkrooms !== 'object' || Array.isArray(rawWorkrooms)) {
    return ['workroomCatalog: definitions must be an object'];
  }
  const workrooms = rawWorkrooms as Record<string, WorkroomDefinition>;
  const agents = new Set(agentNames);
  const enabledConversationOwners = new Map<string, string>();
  for (const [projectId, workroom] of Object.entries(workrooms)) {
    const path = `workroomCatalog.${projectId}`;
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(projectId)) {
      errors.push(`${path}: projectId must match [a-z0-9][a-z0-9_-]{0,63}`);
    }
    if (!workroom || typeof workroom !== 'object' || Array.isArray(workroom)) {
      errors.push(`${path}: Workroom definition must be an object`);
      continue;
    }
    if (typeof workroom.name !== 'string' || !workroom.name.trim()) {
      errors.push(`${path}.name: name is required`);
    }
    if (workroom.description !== undefined && typeof workroom.description !== 'string') {
      errors.push(`${path}.description: description must be a string`);
    }
    if (workroom.enabled !== undefined && typeof workroom.enabled !== 'boolean') {
      errors.push(`${path}.enabled: enabled must be a boolean`);
    }
    if (!Array.isArray(workroom.members)) {
      errors.push(`${path}.members: members must be an array`);
      continue;
    }
    const memberAgents = new Set<string>();
    const memberKeys = new Set<string>();
    let orchestrators = 0;
    workroom.members.forEach((member, index) => {
      const memberPath = `${path}.members.${index}`;
      if (!member || typeof member !== 'object') {
        errors.push(`${memberPath}: member must be an object`);
        return;
      }
      if (typeof member.agent !== 'string' || !member.agent.trim()) {
        errors.push(`${memberPath}.agent: agent is required`);
      } else if (!agents.has(member.agent)) {
        errors.push(`${memberPath}.agent: unknown Agent "${member.agent}"`);
      }
      if (!WORKROOM_ROLES.has(member.role)) {
        errors.push(`${memberPath}.role: invalid Workroom role "${String(member.role)}"`);
      }
      if (member.role === 'orchestrator') orchestrators += 1;
      const key = `${member.agent}:${member.role}`;
      if (memberKeys.has(key)) errors.push(`${memberPath}: duplicate Agent role membership "${key}"`);
      memberKeys.add(key);
      if (typeof member.agent === 'string' && member.agent) memberAgents.add(member.agent);
    });
    if (workroom.enabled !== false && orchestrators === 0) {
      errors.push(`${path}.members: enabled Workroom requires an orchestrator`);
    }
    const conversation = workroom.conversation;
    if (workroom.enabled !== false && !conversation) {
      errors.push(`${path}.conversation: enabled Workroom requires a collaboration space binding`);
      continue;
    }
    if (!conversation) continue;
    const conversationPath = `${path}.conversation`;
    if (!conversation || typeof conversation !== 'object' || Array.isArray(conversation)) {
      errors.push(`${conversationPath}: conversation binding must be an object`);
      continue;
    }
    if (typeof conversation.adapter !== 'string' || !conversation.adapter.trim()) {
      errors.push(`${conversationPath}.adapter: adapter is required`);
    }
    if (typeof conversation.endpoint !== 'string' || !conversation.endpoint.trim()) {
      errors.push(`${conversationPath}.endpoint: endpoint is required`);
    }
    if (conversation.kind !== 'group' && conversation.kind !== 'channel' && conversation.kind !== 'repository') {
      errors.push(`${conversationPath}.kind: kind must be group, channel, or repository`);
    }
    if (typeof conversation.id !== 'string' || !conversation.id.trim()) {
      errors.push(`${conversationPath}.id: collaboration space id is required`);
    } else if (conversation.kind === 'repository'
      && !/^[^/\s]+\/[^/\s]+$/u.test(conversation.id.trim())) {
      errors.push(`${conversationPath}.id: repository id must be owner/repo`);
    }
    if (typeof conversation.agent !== 'string' || !memberAgents.has(conversation.agent)) {
      errors.push(`${conversationPath}.agent: Agent must be a Workroom member`);
    } else if (!workroom.members.some(member =>
      member.agent === conversation.agent && member.role === 'orchestrator')) {
      errors.push(`${conversationPath}.agent: Project Inbox Agent must have the orchestrator role`);
    }
    const endpointKey = `${conversation.adapter}:${conversation.endpoint}`;
    if (endpointKeys && !endpointKeys.has(endpointKey)) {
      errors.push(`${conversationPath}: unknown configured Bot Endpoint "${endpointKey}"`);
    }
    if (workroom.enabled !== false) {
      const canonicalId = conversation.kind === 'repository'
        ? conversation.id.toLowerCase()
        : conversation.id;
      const address = `${endpointKey}:${conversation.kind}:${canonicalId}`;
      const owner = enabledConversationOwners.get(address);
      if (owner) {
        errors.push(`${conversationPath}: conversation "${address}" is already owned by enabled Workroom "${owner}"`);
      } else {
        enabledConversationOwners.set(address, projectId);
      }
    }
  }
  return errors;
}
