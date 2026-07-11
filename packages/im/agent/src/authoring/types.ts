/**
 * Authoring surface types — Eve-style filesystem-first agent definitions.
 * Identity comes from the path; definitions do not carry name/id fields.
 */

import type { ToolParametersSchema } from '../orchestrator/types.js';
import type { Message } from '@zhin.js/core';

export const AUTHORING_KIND = Symbol.for('zhin.authoring.kind');

export type AuthoringKind =
  | 'agent'
  | 'tool'
  | 'skill'
  | 'schedule'
  | 'connection'
  | 'hook'
  | 'eval';

export interface AuthoringMarker {
  [AUTHORING_KIND]: AuthoringKind;
}

export interface AuthoringToolContext {
  pluginName: string;
  runtimeName: string;
  filePath: string;
}

export interface AuthoringAgentDefinition extends AuthoringMarker {
  [AUTHORING_KIND]: 'agent';
  description?: string;
  keywords?: string[];
  tags?: string[];
  role?: string;
  contextMode?: 'fork' | 'fresh';
  maxIterations?: number;
  toolNames?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
}

export interface AuthoringToolDefinition<TInput = Record<string, unknown>> extends AuthoringMarker {
  [AUTHORING_KIND]: 'tool';
  description: string;
  inputSchema: unknown;
  execute: (input: TInput, ctx: AuthoringToolContext) => unknown | Promise<unknown>;
  platforms?: string[];
  scopes?: ('private' | 'group' | 'channel')[];
  permissions?: string[];
  tags?: string[];
  keywords?: string[];
  hidden?: boolean;
}

export interface AuthoringSkillDefinition extends AuthoringMarker {
  [AUTHORING_KIND]: 'skill';
  description: string;
  content: string;
  keywords?: string[];
  tags?: string[];
  toolNames?: string[];
  always?: boolean;
  platforms?: string[];
}

export interface AuthoringScheduleDefinition extends AuthoringMarker {
  [AUTHORING_KIND]: 'schedule';
  cron: string;
  description?: string;
  execute: () => void | Promise<void>;
}

export type ConnectionTransport = 'stdio' | 'streamable-http' | 'sse';

export interface AuthoringConnectionDefinition extends AuthoringMarker {
  [AUTHORING_KIND]: 'connection';
  description: string;
  transport: ConnectionTransport;
  configSchema: unknown;
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  buildEntry: (config: Record<string, unknown>) => {
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
  };
}

export interface AuthoringHookDefinition extends AuthoringMarker {
  [AUTHORING_KIND]: 'hook';
  event: string;
  handler: (event: import('../orchestrator/types.js').AIHookEvent) => void | Promise<void>;
}

export interface AuthoringEvalContext {
  send: (message: string) => Promise<void>;
  get reply(): string;
  succeeded: () => void;
  calledTool: (name: string) => { soft: () => void };
}

export interface AuthoringEvalDefinition extends AuthoringMarker {
  [AUTHORING_KIND]: 'eval';
  description?: string;
  test: (t: AuthoringEvalContext) => void | Promise<void>;
}

export interface DiscoveredAuthoringTool {
  runtimeName: string;
  slotName: string;
  pluginName: string;
  filePath: string;
  definition: AuthoringToolDefinition;
}

export interface DiscoveredAuthoringSkill {
  runtimeName: string;
  slotName: string;
  pluginName: string;
  filePath: string;
  definition: AuthoringSkillDefinition;
}

export interface DiscoveredAuthoringSchedule {
  runtimeName: string;
  slotName: string;
  pluginName: string;
  filePath: string;
  definition: AuthoringScheduleDefinition;
}

export interface DiscoveredAuthoringConnection {
  runtimeName: string;
  slotName: string;
  pluginName: string;
  filePath: string;
  definition: AuthoringConnectionDefinition;
}

export interface DiscoveredAuthoringHook {
  runtimeName: string;
  slotName: string;
  pluginName: string;
  filePath: string;
  definition: AuthoringHookDefinition;
}

export interface DiscoveredAuthoringEval {
  runtimeName: string;
  slotName: string;
  pluginName: string;
  filePath: string;
  definition: AuthoringEvalDefinition;
}

export interface DiscoveredPluginAgentSurface {
  pluginName: string;
  agentDir: string;
  agentDefinition?: AuthoringAgentDefinition;
  instructionsPath?: string;
  instructionsBody?: string;
  tools: DiscoveredAuthoringTool[];
  skills: DiscoveredAuthoringSkill[];
  schedules: DiscoveredAuthoringSchedule[];
  connections: DiscoveredAuthoringConnection[];
  hooks: DiscoveredAuthoringHook[];
  evals: DiscoveredAuthoringEval[];
  subagents: DiscoveredPluginAgentSurface[];
}

export function isAuthoringDefinition(value: unknown, kind: AuthoringKind): boolean {
  return typeof value === 'object' && value !== null
    && (value as AuthoringMarker)[AUTHORING_KIND] === kind;
}

export type BridgedToolExecute = (args: Record<string, unknown>, message?: Message) => unknown | Promise<unknown>;

export interface BridgedToolFromAuthoring {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  execute: BridgedToolExecute;
  platforms?: string[];
  scopes?: ('private' | 'group' | 'channel')[];
  permissions?: string[];
  tags?: string[];
  keywords?: string[];
  hidden?: boolean;
  source: string;
  filePath: string;
}
