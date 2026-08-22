/**
 * ToolRegistry — unified tool management with common/specialized support.
 *
 * Owns registry state and delegates tool semantics to tool-selection:
 *   - core/built/tool.ts (ToolFeature, ZhinTool, permission checking)
 *   - ai/tool-filter.ts + tool-search-cache.ts (relevance filtering)
 */

import { type AgentTool, type ToolFilterOptions, isBuiltinToolSource, isReservedToolName } from '@zhin.js/ai';
import { getLogger } from '@zhin.js/core';
import { ResourceRegistry } from './resource-registry.js';
import { RESERVED_TOOL_NAMES, RESERVED_TOOL_NAME_PREFIXES } from '../reserved-tools.js';
import type {
  ResourceScope,
  Tool,
  Message,
  SenderRole,
  ToolParametersSchema,
  PropertySchema,
  ToolScope,
} from './types.js';
import {
  canAccessTool,
  sharedToolSelection,
  type ToolLike,
} from './tool-selection.js';
export { canAccessTool } from './tool-selection.js';
export type { ToolLike } from './tool-selection.js';

// ============================================================================
// ZhinTool — chainable tool builder (migrated from core/built/tool.ts)
// ============================================================================

interface ParamDef {
  name: string;
  schema: PropertySchema;
  required: boolean;
}

type MaybePromise<T> = T | Promise<T>;

export class ZhinTool {
  #name: string;
  #description: string = '';
  #params: ParamDef[] = [];
  #execute?: (args: Record<string, any>, commMessage?: Message) => MaybePromise<any>;
  #platforms: string[] = [];
  #scopes: ToolScope[] = [];
  #permissions: string[] = [];
  #tags: string[] = [];
  #keywords: string[] = [];
  #hidden: boolean = false;
  #source?: string;
  #preExecutable: boolean = false;
  #kind?: string;

  constructor(name: string) { this.#name = name; }

  get name(): string { return this.#name; }
  get description(): string { return this.#description; }
  get params(): ParamDef[] { return [...this.#params]; }

  desc(description: string): this { this.#description = description; return this; }

  param(name: string, schema: PropertySchema, required = false): this {
    const idx = this.#params.findIndex(p => p.name === name);
    if (idx >= 0) this.#params[idx] = { name, schema, required };
    else this.#params.push({ name, schema, required });
    return this;
  }

  platform(...platforms: string[]): this { this.#platforms.push(...platforms); return this; }
  scope(...scopes: ToolScope[]): this { this.#scopes.push(...scopes); return this; }
  permit(...permissions: string[]): this { this.#permissions.push(...permissions); return this; }
  tag(...tags: string[]): this { this.#tags.push(...tags); return this; }
  keyword(...keywords: string[]): this { this.#keywords.push(...keywords); return this; }
  hidden(value = true): this { this.#hidden = value; return this; }
  preExec(value = true): this { this.#preExecutable = value; return this; }
  kind(value: string): this { this.#kind = value; return this; }

  execute(callback: (args: Record<string, any>, commMessage?: Message) => MaybePromise<any>): this {
    this.#execute = callback;
    return this;
  }

  #buildParameters(): ToolParametersSchema {
    const properties: Record<string, PropertySchema> = {};
    const required: string[] = [];
    const sorted = [...this.#params].sort((a, b) => {
      if (a.required && !b.required) return -1;
      if (!a.required && b.required) return 1;
      return 0;
    });
    for (const p of sorted) {
      properties[p.name] = p.schema;
      if (p.required) required.push(p.name);
    }
    return { type: 'object', properties, required: required.length > 0 ? required : undefined };
  }

  toTool(): Tool {
    if (!this.#execute) throw new Error(`Tool "${this.#name}" has no execute() defined`);
    const tool: Tool = {
      name: this.#name,
      description: this.#description,
      parameters: this.#buildParameters(),
      execute: this.#execute,
    };
    if (this.#platforms.length > 0) tool.platforms = this.#platforms;
    if (this.#scopes.length > 0) tool.scopes = this.#scopes;
    if (this.#permissions.length > 0) tool.permissions = this.#permissions;
    if (this.#tags.length > 0) tool.tags = this.#tags;
    if (this.#hidden) tool.hidden = this.#hidden;
    if (this.#source) tool.source = this.#source;
    if (this.#keywords.length > 0) tool.keywords = this.#keywords;
    if (this.#preExecutable) tool.preExecutable = true;
    if (this.#kind) tool.kind = this.#kind;
    return tool;
  }

  toJSON() {
    const json: Record<string, any> = {
      name: this.#name,
      description: this.#description,
      parameters: this.#buildParameters(),
    };
    if (this.#platforms.length > 0) json.platforms = this.#platforms;
    if (this.#scopes.length > 0) json.scopes = this.#scopes;
    if (this.#permissions.length > 0) json.permissions = [...this.#permissions];
    if (this.#tags.length > 0) json.tags = this.#tags;
    return json;
  }

  get help(): string {
    const lines: string[] = [this.#name];
    if (this.#description) lines.push(`  ${this.#description}`);
    if (this.#params.length > 0) {
      lines.push('  参数:');
      for (const p of this.#params) {
        const req = p.required ? '(必填)' : '(可选)';
        lines.push(`    ${p.name}: ${p.schema.type} ${req} ${p.schema.description || ''}`);
      }
    }
    if (this.#permissions.length > 0) lines.push(`  权限: ${this.#permissions.join(', ')}`);
    if (this.#platforms.length > 0) lines.push(`  平台: ${this.#platforms.join(', ')}`);
    if (this.#scopes.length > 0) lines.push(`  场景: ${this.#scopes.join(', ')}`);
    return lines.join('\n');
  }

  toString(): string { return `[ZhinTool: ${this.#name}] ${this.#description}`; }
}

export function isZhinTool(obj: any): obj is ZhinTool {
  return obj instanceof ZhinTool;
}

export function defineTool<TArgs extends Record<string, any> = Record<string, any>>(tool: Tool<TArgs>): Tool {
  return tool as Tool;
}

export function extractParamInfo(parameters: ToolParametersSchema): Tool.ParamInfo[] {
  if (!parameters.properties) return [];
  const required = parameters.required || [];
  return Object.entries(parameters.properties).map(([name, schema]) => ({
    name, type: schema.type, required: required.includes(name),
    description: schema.description, default: schema.default, enum: schema.enum,
  }));
}

export type ToolInput = Tool | ZhinTool;

// ============================================================================
// ToolRegistry
// ============================================================================

export class ToolRegistry extends ResourceRegistry<AgentTool> {
  private readonly logger = getLogger('ToolRegistry');
  private readonly toolPluginMap = new Map<string, string>();

  addTool(input: ToolInput | AgentTool | ToolLike, scope?: ResourceScope, source?: string): () => void {
    const incomingSource = source || 'unknown';
    const normalized = sharedToolSelection.normalize(input);
    const tool: AgentTool = {
      ...normalized,
      source: normalized.source || (input as { source?: string })?.source || incomingSource,
    };
    const protectedName = isReservedToolName(tool.name, {
      reservedNames: RESERVED_TOOL_NAMES,
      reservedPrefixes: RESERVED_TOOL_NAME_PREFIXES,
    });
    if (protectedName && !isBuiltinToolSource(tool.source)) {
      this.logger.warn(`[工具命名] name=${tool.name} source=${incomingSource} action=ignored reason=reserved_name`);
      return () => {};
    }
    const existingEntry = this.getEntry(tool.name, scope);
    if (existingEntry) {
      this.logger.warn(`[工具命名] name=${tool.name} source=${incomingSource} action=overridden previous=${existingEntry.source} reason=duplicate_name_last_wins`);
    }
    sharedToolSelection.invalidate();
    return this.add(tool, scope, incomingSource);
  }

  removeTool(name: string, scope?: ResourceScope): boolean {
    sharedToolSelection.invalidate();
    this.toolPluginMap.delete(name);
    return this.remove(name, scope);
  }

  filterByContext(tools: Tool[], commMessage: Message): Tool[] {
    return tools.filter(t => canAccessTool(t, commMessage));
  }

  filterByRelevance(message: string, agentId?: string, options?: ToolFilterOptions): AgentTool[] {
    const pool = agentId ? this.getForAgent(agentId) : this.getAll();
    return sharedToolSelection.filterByRelevance(message, pool, options);
  }

  async execute(name: string, args: Record<string, any>, _commMessage?: Message): Promise<unknown> {
    const tool = this.get(name) ?? this.findInSpecialized(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    return tool.execute(args);
  }

  getByTags(tags: string[]): AgentTool[] {
    return this.getAll().filter(t => tags.some(tag => t.tags?.includes(tag)));
  }

  setToolPluginMap(toolName: string, pluginName: string): void {
    this.toolPluginMap.set(toolName, pluginName);
  }

  getToolsByPlugin(pluginName: string): AgentTool[] {
    const result: AgentTool[] = [];
    for (const [toolName, pName] of this.toolPluginMap) {
      if (pName === pluginName) {
        const t = this.get(toolName);
        if (t) result.push(t);
      }
    }
    return result;
  }

  override dispose(): void {
    this.toolPluginMap.clear();
    sharedToolSelection.invalidate();
    super.dispose();
  }

  private findInSpecialized(name: string): AgentTool | undefined {
    for (const agentMap of this.specialized.values()) {
      const entry = agentMap.get(name);
      if (entry) return entry.resource;
    }
    return undefined;
  }
}
