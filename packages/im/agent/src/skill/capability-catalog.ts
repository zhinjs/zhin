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

/** Longest one-line description kept per deferred tool index entry. */
export const TOOL_INDEX_DESCRIPTION_MAX_CHARS = 60;

/** Longest one-line description kept per catalog entry. */
export const CATALOG_DESCRIPTION_MAX_CHARS = 96;
/** Entries listed before the rest are left to `discover`. */
export const CATALOG_MAX_ENTRIES = 40;

export interface CatalogEntry {
  readonly name: string;
  readonly description: string;
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
  descriptionMax = CATALOG_DESCRIPTION_MAX_CHARS,
): string[] {
  const listed = entries.slice(0, CATALOG_MAX_ENTRIES);
  const lines = listed.map((entry) => {
    const description = oneLineDescription(entry.description, descriptionMax);
    return description ? `- ${entry.name}: ${description}` : `- ${entry.name}`;
  });
  const hidden = entries.length - listed.length;
  if (hidden > 0) lines.push(`- …and ${hidden} more; ${overflowHint}`);
  return lines;
}

/** Skill catalog block: names and one-line triggers, plus the load_skill hint. */
export function renderSkillCatalog(skills: readonly CatalogEntry[]): string | undefined {
  if (skills.length === 0) return undefined;
  return [
    SKILL_CATALOG_HEADING,
    SKILL_DISCLOSURE_PROMPT_HINT,
    ...renderEntries(skills, 'use discover(kind=skill) to search them.'),
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
 * Deferred tool index (#729, M2.2): tools whose schema is not sent up front,
 * listed by name and a short description so the model knows they exist.
 * Calling one loads it on demand; `load_tool` or `discover` work as well.
 */
export function renderDeferredToolIndex(tools: readonly CatalogEntry[]): string | undefined {
  if (tools.length === 0) return undefined;
  return [
    DEFERRED_TOOL_INDEX_HEADING,
    'These tools are available but their parameters are not loaded yet. Call load_tool(name) first, or discover(kind=tool) to search.',
    ...renderEntries(tools, 'use discover(kind=tool) to search them.', TOOL_INDEX_DESCRIPTION_MAX_CHARS),
  ].join('\n');
}
