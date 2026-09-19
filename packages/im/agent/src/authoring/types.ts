/**
 * Authoring surface types — Eve-style filesystem-first agent definitions.
 * Identity comes from the path; definitions do not carry name/id fields.
 */


export const AUTHORING_KIND = Symbol.for('zhin.authoring.kind');

export type AuthoringKind =
  | 'agent'
  | 'skill'
  | 'schedule'
  | 'connection'
  | 'hook'
  | 'eval';

export interface AuthoringMarker {
  [AUTHORING_KIND]: AuthoringKind;
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
  /** Tool names or {@link disableTool} sentinels to exclude from this agent. */
  disallowedTools?: (string | import('./disable-tool.js').DisabledToolRef)[];
  systemPrompt?: string;
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
  handler: (event: import('../resource-hub/types.js').AIHookEvent) => void | Promise<void>;
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
