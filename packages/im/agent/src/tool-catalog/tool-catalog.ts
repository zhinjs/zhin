import type { AgentTool } from '@zhin.js/ai';
import { filterTools } from '@zhin.js/ai';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { DiscoverKind, DiscoverResultItem, ToolCatalogItem, ToolCatalogSource } from './types.js';
import { DEFERRED_META_TOOL_NAMES } from './types.js';

export interface BuildToolCatalogOptions {
  tools: AgentTool[];
  mcpServerByTool?: Map<string, string>;
  alwaysLoaded: Set<string>;
}

function briefFromTool(tool: AgentTool): string {
  const desc = tool.description?.trim() ?? '';
  return desc.length > 120 ? `${desc.slice(0, 117)}...` : desc;
}

function inferSource(tool: AgentTool, mcpServer?: string): ToolCatalogSource {
  if (DEFERRED_META_TOOL_NAMES.has(tool.name)) return 'meta';
  if (mcpServer) return 'mcp';
  const src = tool.source ?? '';
  if (src.startsWith('builtin')) return 'builtin';
  if (src.includes('skill')) return 'skill';
  return 'plugin';
}

export function buildToolCatalog(options: BuildToolCatalogOptions): ToolCatalogItem[] {
  const { tools, mcpServerByTool, alwaysLoaded } = options;
  const items: ToolCatalogItem[] = [];
  const seen = new Set<string>();

  for (const tool of tools) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    const mcpServer = mcpServerByTool?.get(tool.name);
    const isAlways = alwaysLoaded.has(tool.name);
    items.push({
      name: tool.name,
      brief: briefFromTool(tool),
      fullTool: tool,
      source: inferSource(tool, mcpServer),
      mcpServer,
      deferDefault: !isAlways && !DEFERRED_META_TOOL_NAMES.has(tool.name),
    });
  }
  return items;
}

export function catalogToolByName(catalog: ToolCatalogItem[]): Map<string, ToolCatalogItem> {
  return new Map(catalog.map(item => [item.name, item]));
}

export interface DiscoverInCatalogOptions {
  query: string;
  kind: DiscoverKind;
  topK: number;
  platform?: string;
  mcpServer?: string;
  skillRegistry: SkillRegistry | null;
  catalog: ToolCatalogItem[];
}

export function discoverInCatalog(options: DiscoverInCatalogOptions): DiscoverResultItem[] {
  const { query, kind, topK, platform, mcpServer, skillRegistry, catalog } = options;
  const q = query.trim();
  const results: DiscoverResultItem[] = [];

  const wantTools = kind === 'tool' || kind === 'all';
  const wantSkills = kind === 'skill' || kind === 'all';

  if (wantTools && q) {
    const pool = catalog
      .filter(item => item.source !== 'meta' && !DEFERRED_META_TOOL_NAMES.has(item.name))
      .filter(item => !mcpServer || item.mcpServer === mcpServer)
      .map(item => item.fullTool);
    const ranked = filterTools(q, pool, { maxTools: topK, minScore: 0.08 });
    for (const tool of ranked) {
      const item = catalog.find(c => c.name === tool.name);
      results.push({
        kind: 'tool',
        name: tool.name,
        brief: item?.brief ?? briefFromTool(tool),
        score: 1,
      });
    }
  }

  if (wantSkills) {
    if (skillRegistry && skillRegistry.size > 0) {
      const skills = skillRegistry.search(q, { maxResults: topK, platform });
      for (const skill of skills) {
        results.push({
          kind: 'skill',
          name: skill.name,
          brief: skill.description?.slice(0, 120) ?? '',
          score: 1,
        });
      }
    }
  }

  if (kind === 'all' && q) {
    const toolResults = results.filter(r => r.kind === 'tool').slice(0, topK);
    const skillResults = results.filter(r => r.kind === 'skill').slice(0, topK);
    return [...toolResults, ...skillResults];
  }

  return results.slice(0, topK * (kind === 'all' ? 2 : 1));
}

export function resolveDeferredApiTools(
  catalog: ToolCatalogItem[],
  alwaysLoaded: Set<string>,
  sessionLoadedNames: string[],
): AgentTool[] {
  const byName = catalogToolByName(catalog);
  const out: AgentTool[] = [];
  const seen = new Set<string>();

  for (const name of alwaysLoaded) {
    if (seen.has(name)) continue;
    const item = byName.get(name);
    if (item) {
      out.push(item.fullTool);
      seen.add(name);
    }
  }

  for (const name of sessionLoadedNames) {
    if (seen.has(name)) continue;
    const item = byName.get(name);
    if (item) {
      out.push(item.fullTool);
      seen.add(name);
    }
  }

  return out;
}

export function buildDeferredStats(catalog: ToolCatalogItem[], apiTools: AgentTool[]): string {
  const apiNames = new Set(apiTools.map(t => t.name));
  const deferred = catalog.filter(c => !apiNames.has(c.name));
  const bySource = new Map<string, number>();
  for (const item of deferred) {
    bySource.set(item.source, (bySource.get(item.source) ?? 0) + 1);
  }
  const parts = [...bySource.entries()].map(([k, v]) => `${k}:${v}`);
  return `deferred ${deferred.length} tools (${parts.join(', ') || 'none'}); loaded ${apiTools.length}`;
}

export type { DiscoverKind, DiscoverResultItem, ToolCatalogItem, ToolCatalogSource } from './types.js';
