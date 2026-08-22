import {
  addSkillToSnapshot,
  getLoadedToolNamesFromSnapshot,
  touchToolInSnapshot,
  touchToolsInSnapshot,
  type AgentTool,
  type DeferredToolSessionSnapshot,
} from '@zhin.js/ai';
import type { Tool, ToolResult } from '@zhin.js/core';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SkillRegistry } from '../resource-hub/skill-registry.js';
import { readSkillInstructions, type LoadSkillToolOptions } from '../builtin/load-skill-tool.js';
import { catalogToolByName, discoverInCatalog, type DiscoverKind } from './tool-catalog.js';
import type { ToolCatalogItem } from './types.js';

export const TOOLS_MUTATED_MARKER = '__zhin_tools_mutated__';

export interface DeferredTurnControllerOptions {
  readonly sessionId: string;
  readonly platform?: string;
  readonly catalog: readonly ToolCatalogItem[];
  readonly skillRegistry: SkillRegistry | null;
  readonly snapshot: DeferredToolSessionSnapshot;
  readonly maxLoadedPerSession: number;
  readonly discoverTopK: number;
  readonly persistSnapshot: (snapshot: DeferredToolSessionSnapshot) => Promise<void>;
  readonly onSkillLoaded?: (name: string, instructions: string, toolNames: string[]) => void;
  readonly skillLoadOpts: LoadSkillToolOptions;
}

export interface DeferredTurnController {
  readonly tools: readonly Tool[];
  snapshot(): DeferredToolSessionSnapshot;
  loadedToolNames(): string[];
  tool(name: string): AgentTool | undefined;
  fork(): DeferredTurnController;
}

const activeController = new AsyncLocalStorage<DeferredTurnController>();

export function runWithDeferredTurnController<TResult>(
  controller: DeferredTurnController,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  return activeController.run(controller, operation);
}

export function getActiveDeferredTurnController(): DeferredTurnController | undefined {
  return activeController.getStore();
}

const MEMORY_HINT_KEYWORDS = ['memory', 'remember', 'recall', 'store', '记忆', '记住', '记下', '回忆', '备忘'];
const MEMORY_FALLBACK_HINT =
  'No matches. 语义记忆工具未启用（需配置 ai.memory.semantic.enabled: true）。'
  + '可使用 write_file 将信息写入 data/memory/sessions/…/MEMORY.md 作为文件记忆替代。';

function formatDiscoverResults(items: ReturnType<typeof discoverInCatalog>, query?: string): string {
  if (items.length === 0) {
    if (query && MEMORY_HINT_KEYWORDS.some(keyword => query.toLowerCase().includes(keyword))) {
      return MEMORY_FALLBACK_HINT;
    }
    return 'No matches.';
  }
  return items.map(item => `- [${item.kind}] ${item.name}: ${item.brief}`).join('\n');
}

function schemaSummary(item: ToolCatalogItem): string {
  const params = item.fullTool.parameters;
  if (!params) return `Loaded tool "${item.name}".`;
  return `Loaded tool "${item.name}".\nParameters schema:\n${JSON.stringify(params, null, 2)}`;
}

export function createDeferredTurnController(
  options: DeferredTurnControllerOptions,
): DeferredTurnController {
  let currentSnapshot = structuredClone(options.snapshot);
  const catalog = [...options.catalog];
  const byName = catalogToolByName(catalog);

  const persist = async (next: DeferredToolSessionSnapshot): Promise<void> => {
    currentSnapshot = next;
    await options.persistSnapshot(currentSnapshot);
  };

  const tools: Tool[] = [
    {
      name: 'discover',
      description: 'Search deferred tools and skills by query. kind: tool|skill|all (default all). Empty query returns platform-matched skills.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (user intent keywords)' },
          kind: { type: 'string', enum: ['tool', 'skill', 'all'], description: 'What to search (default all)' },
          mcp_server: { type: 'string', description: 'Filter tools by MCP server name' },
        },
      },
      source: 'builtin:agent',
      execute: async (args): Promise<ToolResult> => {
        const input = args as Record<string, unknown>;
        const kind = (typeof input.kind === 'string' ? input.kind : 'all') as DiscoverKind;
        const query = typeof input.query === 'string' ? input.query : '';
        const mcpServer = typeof input.mcp_server === 'string' ? input.mcp_server : undefined;
        return formatDiscoverResults(discoverInCatalog({
          query,
          kind,
          topK: options.discoverTopK,
          platform: options.platform,
          mcpServer,
          skillRegistry: options.skillRegistry,
          catalog,
        }), query);
      },
    },
    {
      name: 'load_tool',
      description: 'Load a deferred tool schema into this turn so it can be called.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Tool name from discover results' } },
        required: ['name'],
      },
      source: 'builtin:agent',
      execute: async (args): Promise<ToolResult> => {
        const name = String((args as Record<string, unknown>).name);
        const item = byName.get(name);
        if (!item) return `Tool "${name}" not found in catalog.`;
        await persist(touchToolInSnapshot(currentSnapshot, name, options.maxLoadedPerSession));
        return `${schemaSummary(item)}\n${TOOLS_MUTATED_MARKER}`;
      },
    },
    {
      name: 'load_skill',
      description: 'Load full skill instructions and unlock associated tools for this turn.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Skill name from discover results' } },
        required: ['name'],
      },
      source: 'builtin:agent',
      execute: async (args): Promise<ToolResult> => {
        const name = String((args as Record<string, unknown>).name);
        const instructions = await readSkillInstructions(name, options.skillLoadOpts);
        if (instructions.startsWith(`Skill '${name}' not found`)) return instructions;
        let next = addSkillToSnapshot(currentSnapshot, name);
        const toolNames = options.skillRegistry?.getByName(name)?.tools?.map(tool => tool.name) ?? [];
        next = touchToolsInSnapshot(next, toolNames, options.maxLoadedPerSession);
        await persist(next);
        options.onSkillLoaded?.(name, instructions, toolNames);
        const unlock = toolNames.length > 0 ? `\nUnlocked tools: ${toolNames.join(', ')}` : '';
        return `${instructions}${unlock}\n${TOOLS_MUTATED_MARKER}`;
      },
    },
  ];

  return Object.freeze({
    tools: Object.freeze(tools),
    snapshot: () => currentSnapshot,
    loadedToolNames: () => getLoadedToolNamesFromSnapshot(currentSnapshot),
    tool: (name: string) => byName.get(name)?.fullTool,
    fork: () => createDeferredTurnController({
      ...options,
      snapshot: currentSnapshot,
      persistSnapshot: async () => undefined,
    }),
  });
}

export function isToolsMutatedResult(result: ToolResult): boolean {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return text.includes(TOOLS_MUTATED_MARKER);
}
