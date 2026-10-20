/**
 * Authoring surface types — Eve-style filesystem-first agent definitions.
 * Identity comes from the path; definitions do not carry name/id fields.
 */

export const AUTHORING_KIND = Symbol.for('zhin.authoring.kind');

export type AuthoringKind =
  | 'skill'
  | 'hook'
  | 'eval';

export interface AuthoringMarker {
  [AUTHORING_KIND]: AuthoringKind;
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

export interface DiscoveredAuthoringHook {
  runtimeName: string;
  slotName: string;
  pluginName: string;
  filePath: string;
  definition: AuthoringHookDefinition;
  agentName?: string;
  skillName?: string;
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
  hooks: DiscoveredAuthoringHook[];
  evals: DiscoveredAuthoringEval[];
}

export function isAuthoringDefinition(value: unknown, kind: AuthoringKind): boolean {
  return typeof value === 'object' && value !== null
    && (value as AuthoringMarker)[AUTHORING_KIND] === kind;
}
