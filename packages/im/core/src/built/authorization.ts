/**
 * 授权重算 — ConfigFeature + Message 为单一真相源（$sender.isMaster/isTrusted 为 enrich 快照）
 */
import type { Plugin } from '../plugin.js';
import type { Message } from '../message.js';
import { mergeAITriggerConfig, resolveSenderRoles, type AITriggerConfig, type SenderRolesResult, } from './ai-trigger.js';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('Authorization');

interface YamlEndpointEntry {
  context?: string;
  name?: string;
  master?: unknown;
  trusted?: unknown;
  [key: string]: unknown;
}

interface PrimaryConfig {
  ai?: { trigger?: AITriggerConfig };
  endpoints?: YamlEndpointEntry[];
}

function findEndpointEntryFromConfig(
  config: PrimaryConfig,
  adapter: string,
  endpointId: string,
): YamlEndpointEntry | undefined {
  const endpoints = config.endpoints;
  if (!Array.isArray(endpoints)) return undefined;
  return endpoints.find(
    (b) => b.context === adapter && String(b.name) === endpointId,
  );
}

function readTriggerConfig(plugin: Plugin): AITriggerConfig {
  const root = plugin.root ?? plugin;
  try {
    const ai = root.inject('ai') as { getTriggerConfig?: () => AITriggerConfig } | undefined;
    if (ai?.getTriggerConfig) return ai.getTriggerConfig();
  } catch (e) {
    logger.debug(formatCompact({ auth: 'trigger_config_fallback', reason: 'ai_not_ready' }));
  }
  try {
    const configSvc = root.inject('config') as
      | { getPrimary?: <T>() => T }
      | undefined;
    const primary = configSvc?.getPrimary?.() as PrimaryConfig | undefined;
    return primary?.ai?.trigger ?? {};
  } catch (e) {
    logger.debug(formatCompact({ auth: 'trigger_config_read_error' }));
    return {};
  }
}

function readEndpointConfig(plugin: Plugin, message: Message<any>): Record<string, unknown> | undefined {
  const root = plugin.root ?? plugin;
  try {
    const configSvc = root.inject('config') as
      | { getPrimary?: <T>() => T }
      | undefined;
    const primary = configSvc?.getPrimary?.() as PrimaryConfig | undefined;
    if (!primary) return undefined;
    const entry = findEndpointEntryFromConfig(
      primary,
      String(message.$adapter),
      String(message.$endpoint),
    );
    return entry as Record<string, unknown> | undefined;
  } catch (e) {
    logger.debug(formatCompact({ auth: 'endpoint_config_read_error' }));
    return undefined;
  }
}

/**
 * 从 ConfigFeature + Message 重算发送者角色（含群角色与 master/trusted）
 */
export function resolveSubjectRoles(plugin: Plugin, message: Message<any>): SenderRolesResult {
  const triggerConfig = mergeAITriggerConfig(readTriggerConfig(plugin));
  const endpointConfig = readEndpointConfig(plugin, message);
  return resolveSenderRoles(message, triggerConfig, endpointConfig);
}
