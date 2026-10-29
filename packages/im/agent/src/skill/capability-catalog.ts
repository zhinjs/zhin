/**
 * Compact capability catalog for the system prompt (#729, M2.3).
 *
 * The prompt only carries a name and a one-line trigger description for each
 * skill and specialist agent. Full skill instructions reach the model after
 * `load_skill` (or intent priming), and specialist instructions only when the
 * agent is selected, so the resident prompt stays small as plugins add skills.
 */
import { SKILL_DISCLOSURE_PROMPT_HINT } from './progressive-disclosure.js';

/** Headings the context budget report uses to attribute catalog tokens. */
export const SKILL_CATALOG_HEADING = '## Available skills';
export const AGENT_CATALOG_HEADING = '## Available specialist agents';
export const DEFERRED_TOOL_INDEX_HEADING = '## Deferred tools';

/** Tool names listed per domain line of the deferred tool index; the rest is only counted. */
export const TOOL_INDEX_MAX_NAMES_PER_GROUP = 6;
/** Group label for tools that carry no owner. */
export const TOOL_INDEX_UNGROUPED = 'other';

/** Longest trigger sentence kept per skill catalog entry (ADR 0042 §4). */
export const SKILL_TRIGGER_MAX_CHARS = 40;

/** Longest one-line description kept per catalog entry. */
export const CATALOG_DESCRIPTION_MAX_CHARS = 96;
/** Entries listed before the rest are left to `discover`. */
export const CATALOG_MAX_ENTRIES = 40;

export interface CatalogEntry {
  readonly name: string;
  readonly description: string;
  /** Domain the entry belongs to (owning plugin / skill / MCP server); used by the folded tool index. */
  readonly group?: string;
}

/** First sentence of a description, whitespace-collapsed and clipped to `max` characters. */
export function triggerSentence(description: string, max = SKILL_TRIGGER_MAX_CHARS): string {
  const line = oneLineDescription(description, Number.MAX_SAFE_INTEGER);
  const end = line.search(/[。！？；]|[.!?;](?:\s|$)/u);
  const sentence = (end >= 0 ? line.slice(0, end) : line).trim();
  if (sentence.length <= max) return sentence;
  let cut = sentence.slice(0, max - 1);
  // Prefer a word boundary over cutting a word in half (CJK text has no spaces and is cut as is).
  if (sentence[max - 1] !== ' ') {
    const space = cut.lastIndexOf(' ');
    if (space > max / 2) cut = cut.slice(0, space);
  }
  return `${cut.trimEnd()}…`;
}

/** First line of a description, whitespace-collapsed and clipped to `max` characters. */
export function oneLineDescription(description: string, max = CATALOG_DESCRIPTION_MAX_CHARS): string {
  const firstLine = description.trim().split(/\r?\n/, 1)[0] ?? '';
  const line = firstLine.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

function renderEntries(
  entries: readonly CatalogEntry[],
  overflowHint: string,
  describe: (description: string) => string = (text) => oneLineDescription(text),
): string[] {
  const listed = entries.slice(0, CATALOG_MAX_ENTRIES);
  const lines = listed.map((entry) => {
    const description = describe(entry.description);
    return description ? `- ${entry.name}: ${description}` : `- ${entry.name}`;
  });
  const hidden = entries.length - listed.length;
  if (hidden > 0) lines.push(`- …and ${hidden} more; ${overflowHint}`);
  return lines;
}

/**
 * Domain of a catalog tool: its MCP server, else its owner (plugin id, or the `builtin:` area),
 * else ungrouped. Skill membership is not a tool property, so the owner is the grouping data.
 */
export function toolIndexGroup(item: { readonly mcpServer?: string; readonly fullTool: { readonly source?: string } }): string {
  if (item.mcpServer) return `mcp:${item.mcpServer}`;
  const source = item.fullTool.source?.trim();
  return source ? source.replace(/^plugin:/, '') : TOOL_INDEX_UNGROUPED;
}

const byName = (a: CatalogEntry, b: CatalogEntry): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Skill catalog block: name and one trigger sentence (<= 40 chars) per skill, plus the load_skill
 * hint. Sorted by name so the block is byte-stable across turns; the full description arrives with
 * load_skill / discover.
 */
export function renderSkillCatalog(skills: readonly CatalogEntry[]): string | undefined {
  if (skills.length === 0) return undefined;
  return [
    SKILL_CATALOG_HEADING,
    SKILL_DISCLOSURE_PROMPT_HINT,
    ...renderEntries([...skills].sort(byName), 'use discover(kind=skill) to search them.', (text) => triggerSentence(text)),
  ].join('\n');
}

/** Specialist agent catalog block: names and one-line descriptions. */
export function renderAgentCatalog(agents: readonly CatalogEntry[]): string | undefined {
  if (agents.length === 0) return undefined;
  return [
    AGENT_CATALOG_HEADING,
    ...renderEntries(agents, 'they are not listed here.'),
  ].join('\n');
}

/**
 * Deferred tool index (#729, M2.2; folded per ADR 0042 §4): tools whose schema is not sent up
 * front, one line per domain (owning plugin / skill / MCP server) with up to
 * TOOL_INDEX_MAX_NAMES_PER_GROUP names and the total count. Groups and names are sorted so the
 * block is byte-stable across turns. Calling one loads it on demand; `load_tool` or `discover`
 * work as well, and `discover` gives the details.
 */
export function renderDeferredToolIndex(tools: readonly CatalogEntry[]): string | undefined {
  if (tools.length === 0) return undefined;
  const groups = new Map<string, string[]>();
  for (const tool of tools) {
    const group = tool.group?.trim() || TOOL_INDEX_UNGROUPED;
    const names = groups.get(group);
    if (names) names.push(tool.name);
    else groups.set(group, [tool.name]);
  }
  const lines = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([group, names]) => {
      const sorted = [...new Set(names)].sort();
      const listed = sorted.slice(0, TOOL_INDEX_MAX_NAMES_PER_GROUP).join(', ');
      const more = sorted.length > TOOL_INDEX_MAX_NAMES_PER_GROUP ? ', …' : '';
      return `- ${group}: ${listed}${more} (${sorted.length})`;
    });
  return [
    DEFERRED_TOOL_INDEX_HEADING,
    'These tools are available but their parameters are not loaded yet. Call load_tool(name) first, or discover(kind=tool) to search.',
    ...lines,
  ].join('\n');
}
