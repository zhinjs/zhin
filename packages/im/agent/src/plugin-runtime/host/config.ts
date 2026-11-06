import type {
  AIService,
  AssistantConfig,
  McpServerEntry,
} from '../../index.js';
import { validateVenueDefinitions, type VenueDefinition } from '@zhin.js/core';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  expandEnvironmentValue,
  type ConfigDocumentPort,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';

export type VenueConfig = VenueDefinition;

export interface ExternalPeerConfig {
  readonly platform: string;
  readonly userId: string;
  readonly label?: string;
}

export type AgentHostAIConfig = NonNullable<ConstructorParameters<typeof AIService>[0]> & {
  readonly venues?: readonly VenueDefinition[];
  readonly externalPeers?: readonly ExternalPeerConfig[];
};

type McpServerConfig = NonNullable<AgentHostAIConfig['mcpServers']>[number];

export async function resolveAiConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<AgentHostAIConfig | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  const ai = (document as Record<string, unknown>).ai;
  if (!ai || typeof ai !== 'object') return undefined;
  const rawAi = ai as Record<string, unknown>;
  if (Object.hasOwn(rawAi, 'workroom') || Object.hasOwn(rawAi, 'workrooms')) {
    throw new Error(
      'Configuration key "ai.workroom" has been removed in ADR 0048. Declare shared rooms under "ai.venues" and agent collaboration ceilings under "agents/<name>/agent.json" ("collaboration").',
    );
  }
  const expanded = expandEnvironmentValue(ai, (key) => process.env[key]) as AgentHostAIConfig;
  resolveAgentHostVenues(expanded);
  resolveAgentHostExternalPeers(expanded);
  return expanded;
}

export async function resolveAssistantConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<AssistantConfig | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  const assistant = (document as Record<string, unknown>).assistant;
  if (!assistant || typeof assistant !== 'object') return undefined;
  return expandEnvironmentValue(assistant, (key) => process.env[key]) as AssistantConfig;
}

export function resolveAgentHostVenues(
  ai: AgentHostAIConfig | undefined,
): readonly VenueDefinition[] {
  const raw = ai?.venues;
  if (raw === undefined || raw === null) return Object.freeze([]);
  validateVenueDefinitions(raw);
  return Object.freeze(
    raw.map((venue) =>
      Object.freeze({
        id: venue.id.trim(),
        ...(venue.label ? { label: venue.label.trim() } : {}),
        conversation: Object.freeze({
          platform: venue.conversation.platform.trim(),
          ...(venue.conversation.sceneType ? { sceneType: venue.conversation.sceneType } : {}),
          sceneId: venue.conversation.sceneId.trim(),
          ...(venue.conversation.threadId ? { threadId: venue.conversation.threadId.trim() } : {}),
        }),
        members: Object.freeze(
          venue.members.map((member) =>
            Object.freeze({
              agent: member.agent.trim(),
              botEndpoint: member.botEndpoint.trim(),
              ...(member.aliases?.length
                ? { aliases: Object.freeze(member.aliases.map((a) => a.trim())) }
                : {}),
            }),
          ),
        ),
        ...(venue.entry ? { entry: venue.entry.trim() } : {}),
        ...(venue.visibility ? { visibility: venue.visibility } : {}),
      }),
    ),
  );
}

export function resolveAgentHostExternalPeers(
  ai: AgentHostAIConfig | undefined,
): readonly ExternalPeerConfig[] {
  const raw = ai?.externalPeers;
  if (raw === undefined || raw === null) return Object.freeze([]);
  if (!Array.isArray(raw)) throw new TypeError('ai.externalPeers must be an array');
  const seen = new Set<string>();
  return Object.freeze(
    raw.map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new TypeError(`Invalid ai.externalPeers[${index}] declaration`);
      }
      const platform = typeof item.platform === 'string' ? item.platform.trim() : '';
      const userId = typeof item.userId === 'string' ? item.userId.trim() : '';
      if (!platform || !userId) {
        throw new TypeError(`ai.externalPeers[${index}] requires non-empty platform and userId`);
      }
      const key = `${platform}:${userId}`;
      if (seen.has(key)) {
        throw new Error(`ai.externalPeers contains duplicate peer "${key}"`);
      }
      seen.add(key);
      const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : undefined;
      return Object.freeze({
        platform,
        userId,
        ...(label ? { label } : {}),
      });
    }),
  );
}

export function resolveAgentHostMcpServers(
  ai: AgentHostAIConfig,
): readonly McpServerEntry[] {
  const raw = ai.mcpServers;
  if (raw == null) return Object.freeze([]);
  if (!Array.isArray(raw)) throw new TypeError('ai.mcpServers must be an array');
  return Object.freeze(raw.map((item, index) => {
    const entry = toMcpServerEntry(item);
    if (!entry) throw new TypeError(`Invalid ai.mcpServers[${index}] declaration`);
    return entry;
  }));
}

/** Resolve an explicitly configured project-local knowledge directory. */
export function resolveAgentHostKnowledgeDirectory(
  ai: AgentHostAIConfig,
  projectRoot: string,
): string | undefined {
  if (ai.knowledge === undefined) return undefined;
  const baseDir = ai.knowledge?.baseDir;
  if (typeof baseDir !== 'string' || !baseDir.trim() || baseDir !== baseDir.trim()) {
    throw new TypeError('ai.knowledge.baseDir must be a non-empty canonical path');
  }
  if (baseDir === '~' || baseDir.startsWith('~/') || baseDir.startsWith('~\\')) {
    throw new TypeError('ai.knowledge.baseDir must stay inside the project root');
  }
  if (isAbsolute(baseDir) || baseDir.split(/[\\/]/u).some((segment) => segment === '.' || segment === '..')) {
    throw new TypeError('ai.knowledge.baseDir must be a canonical project-relative path');
  }
  const root = realpathSync(resolve(projectRoot));
  const configured = resolve(root, baseDir);
  const directory = existsSync(configured) ? realpathSync(configured) : configured;
  const relation = relative(root, directory);
  if (relation === '..' || relation.startsWith('../') || relation.startsWith('..\\')) {
    throw new TypeError('ai.knowledge.baseDir must stay inside the project root');
  }
  return directory;
}

async function readConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown> {
  if (!isConfigDocumentPort(config)) return config;
  return (await config.read()).document;
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigDocumentPort>;
  return typeof candidate.read === 'function';
}

function toMcpServerEntry(raw: McpServerConfig): McpServerEntry | undefined {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return undefined;
  const transport = raw.transport;
  if (transport !== 'stdio' && transport !== 'streamable-http' && transport !== 'sse') return undefined;
  if (transport === 'stdio') {
    if (!raw.command?.trim()) return undefined;
  } else if (!raw.url?.trim()) {
    return undefined;
  }
  return {
    name: raw.name.trim(),
    transport,
    ...(raw.url ? { url: raw.url } : {}),
    ...(raw.command ? { command: raw.command } : {}),
    ...(raw.args ? { args: [...raw.args] } : {}),
    ...(raw.env ? { env: { ...raw.env } } : {}),
    ...(raw.headers ? { headers: { ...raw.headers } } : {}),
  };
}
