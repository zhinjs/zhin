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

interface PluginAdapterConfig {
  master?: unknown;
  trusted?: unknown;
  endpoints?: YamlEndpointEntry[];
  [key: string]: unknown;
}

interface PrimaryConfig {
  ai?: { trigger?: AITriggerConfig };
  endpoints?: YamlEndpointEntry[];
  plugins?: Record<string, PluginAdapterConfig>;
}

function findEndpointEntryFromConfig(
  config: PrimaryConfig,
  adapter: string,
  endpointId: string,
): YamlEndpointEntry | undefined {
  // 1) top-level endpoints[] (legacy / flat format)
  const topLevel = config.endpoints;
  if (Array.isArray(topLevel)) {
    const found = topLevel.find(
      (b) => b.context === adapter && String(b.name) === endpointId,
    );
    if (found) return found;
  }

  // 2) plugins.<adapter> — adapter-level master/trusted + nested endpoints[]
  const adapterConfig = config.plugins?.[adapter];
  if (!adapterConfig) return undefined;

  const nested = adapterConfig.endpoints;
  const entry = Array.isArray(nested)
    ? nested.find((b) => String(b.name) === endpointId)
    : undefined;

  // Merge adapter-level master/trusted onto the matched endpoint entry
  // so that resolveSenderRoles sees them in one place
  const merged: YamlEndpointEntry = {
    context: adapter,
    ...(entry ?? { name: endpointId }),
  };
  if (adapterConfig.master != null && merged.master == null) {
    merged.master = adapterConfig.master;
  }
  if (adapterConfig.trusted != null && merged.trusted == null) {
    merged.trusted = adapterConfig.trusted;
  }
  return merged;
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
