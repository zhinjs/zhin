/**
 * Deferred schema meta tools: discover, load_tool, load_skill
 */
import { type AgentTool, type DeferredToolSessionSnapshot, addSkillToSnapshot, touchToolInSnapshot, touchToolsInSnapshot } from '@zhin.js/ai';
import type { Message, Tool, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import {
  catalogToolByName,
  discoverInCatalog,
  type DiscoverKind,
} from '../tool-catalog/tool-catalog.js';
import type { ToolCatalogItem } from '../tool-catalog/types.js';
import { readSkillInstructions, type LoadSkillToolOptions } from './load-skill-tool.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';
export const TOOLS_MUTATED_MARKER = '__zhin_tools_mutated__';

export interface DeferredToolRuntime {
  sessionId: string;
  catalog: ToolCatalogItem[];
  skillRegistry: SkillRegistry | null;
  snapshot: DeferredToolSessionSnapshot;
  maxLoadedPerSession: number;
  discoverTopK: number;
  persistSnapshot: (snapshot: DeferredToolSessionSnapshot) => Promise<void>;
  onSkillLoaded?: (name: string, instructions: string, toolNames: string[]) => void;
  skillLoadOpts: LoadSkillToolOptions;
}

const deferredRuntime = new WeakMap<Message, DeferredToolRuntime>();

export function bindDeferredToolRuntime(message: Message, runtime: DeferredToolRuntime): void {
  deferredRuntime.set(message, runtime);
}

export function getDeferredToolRuntime(message?: Message): DeferredToolRuntime | undefined {
  if (!message) return undefined;
  return deferredRuntime.get(message);
}

function formatDiscoverResults(items: ReturnType<typeof discoverInCatalog>): string {
  if (items.length === 0) return 'No matches.';
  return items
    .map(i => `- [${i.kind}] ${i.name}: ${i.brief}`)
    .join('\n');
}

function schemaSummary(tool: AgentTool): string {
  const params = tool.parameters;
  if (!params) return `Loaded tool "${tool.name}".`;
  return `Loaded tool "${tool.name}".\nParameters schema:\n${JSON.stringify(params, null, 2)}`;
}

export class DiscoverBuiltinTool extends BuiltinBaseTool {
  readonly name = 'discover';
  readonly description =
    'Search deferred tools and skills by query. kind: tool|skill|all (default all). Empty query returns platform-matched skills.';
  readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (user intent keywords)' },
      kind: { type: 'string', enum: ['tool', 'skill', 'all'], description: 'What to search (default all)' },
      mcp_server: { type: 'string', description: 'Filter tools by MCP server name' },
    },
  };

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const runtime = getDeferredToolRuntime(commMessage);
    if (!runtime) return 'deferred runtime not available';
    const kind = (typeof args.kind === 'string' ? args.kind : 'all') as DiscoverKind;
    const query = typeof args.query === 'string' ? args.query : '';
    const mcpServer = typeof args.mcp_server === 'string' ? args.mcp_server : undefined;
    const platform = commMessage ? String(commMessage.$adapter) : undefined;
    const items = discoverInCatalog({
      query,
      kind,
      topK: runtime.discoverTopK,
      platform,
      mcpServer,
      skillRegistry: runtime.skillRegistry,
      catalog: runtime.catalog,
    });
    return formatDiscoverResults(items);
  }
}

export class LoadToolBuiltinTool extends BuiltinBaseTool {
  readonly name = 'load_tool';
  readonly description = 'Load a deferred tool schema into the session so it can be called.';
  readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Tool name from discover results' },
    },
    required: ['name'],
  };

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const runtime = getDeferredToolRuntime(commMessage);
    if (!runtime) return 'deferred runtime not available';
    const name = String(args.name);
    const item = catalogToolByName(runtime.catalog).get(name);
    if (!item) return `Tool "${name}" not found in catalog.`;
    runtime.snapshot = touchToolInSnapshot(runtime.snapshot, name, runtime.maxLoadedPerSession);
    await runtime.persistSnapshot(runtime.snapshot);
    return `${schemaSummary(item.fullTool)}\n${TOOLS_MUTATED_MARKER}`;
  }
}

export class LoadSkillBuiltinToolMeta extends BuiltinBaseTool {
  readonly name = 'load_skill';
  readonly description =
    'Load full skill instructions and unlock associated tools for this session.';
  readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill name from discover results' },
    },
    required: ['name'],
  };

  constructor(private readonly skillOpts: LoadSkillToolOptions) {
    super();
  }

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const runtime = getDeferredToolRuntime(commMessage);
    if (!runtime) return 'deferred runtime not available';
    const name = String(args.name);
    const instructions = await readSkillInstructions(name, this.skillOpts);
    if (instructions.startsWith(`Skill '${name}' not found`)) {
      return instructions;
    }
    runtime.snapshot = addSkillToSnapshot(runtime.snapshot, name);
    const skill = runtime.skillRegistry?.getByName(name);
    const toolNames = skill?.tools?.map(t => t.name) ?? [];
    runtime.snapshot = touchToolsInSnapshot(runtime.snapshot, toolNames, runtime.maxLoadedPerSession);
    await runtime.persistSnapshot(runtime.snapshot);
    runtime.onSkillLoaded?.(name, instructions, toolNames);
    const unlock = toolNames.length > 0 ? `\nUnlocked tools: ${toolNames.join(', ')}` : '';
    return `${instructions}${unlock}\n${TOOLS_MUTATED_MARKER}`;
  }
}

export function createDeferredMetaTools(skillOpts: LoadSkillToolOptions): Tool[] {
  return [
    new DiscoverBuiltinTool().toTool(),
    new LoadToolBuiltinTool().toTool(),
    new LoadSkillBuiltinToolMeta(skillOpts).toTool(),
  ];
}

export function isToolsMutatedResult(result: ToolResult): boolean {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return text.includes(TOOLS_MUTATED_MARKER);
}
