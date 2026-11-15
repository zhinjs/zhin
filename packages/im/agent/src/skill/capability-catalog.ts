/**
 * Compact capability catalog for the system prompt (#729, M2.3).
 *
 * The prompt only carries a name and a one-line trigger description for each
 * skill and specialist agent. Full skill instructions reach the model after
 * `load_skill` (or intent priming), and specialist instructions only when the
 * agent is selected, so the resident prompt stays small as plugins add skills.
 */
/** Headings the context budget report uses to attribute catalog tokens. */
export const SKILL_CATALOG_HEADING = '## Available skills';
export const AGENT_CATALOG_HEADING = '## Available specialist agents';
export const DEFERRED_TOOL_INDEX_HEADING = '## Deferred tools';

/** Tool names listed per domain line of the deferred tool index; the rest is only counted. */
export const TOOL_INDEX_MAX_NAMES_PER_GROUP = 6;
/** Group label for tools that carry no owner. */
export const TOOL_INDEX_UNGROUPED = 'other';

/**
 * Longest summary sentence {@link triggerSentence} keeps by default. The skill catalog itself no
 * longer clips entries to this length: it shares {@link SKILL_CATALOG_BUDGET_CHARS} (#1250 b27).
 */
export const SKILL_TRIGGER_MAX_CHARS = 40;
/**
 * Character budget of the skill catalog entry lines. Within it every entry keeps its summary,
 * `Use when` clause and trigger words; past it summaries are clipped first, `Use when` clauses
 * next and trigger words last (#1250 b27).
 */
export const SKILL_CATALOG_BUDGET_CHARS = 4_000;
/** Longest single skill catalog entry, so one verbose skill cannot take the whole budget. */
export const SKILL_CATALOG_ENTRY_MAX_CHARS = 320;
/** A clipped catalog part shorter than this is dropped instead of kept as a stub. */
const CATALOG_PART_MIN_CHARS = 8;
/** Trigger words are short; one kept word still helps the model match a request. */
const CATALOG_TRIGGER_MIN_CHARS = 3;

/** Longest one-line description kept per catalog entry. */
export const CATALOG_DESCRIPTION_MAX_CHARS = 96;
/** Entries listed before the rest are left to `discover`. */
export const CATALOG_MAX_ENTRIES = 40;

export interface CatalogEntry {
  readonly name: string;
  readonly description: string;
  /** Domain the entry belongs to (owning plugin / skill / MCP server); used by the folded tool index. */
  readonly group?: string;
  /** Skill entries: `keywords` from the SKILL.md frontmatter; listed with the trigger words. */
  readonly keywords?: readonly string[];
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
export function toolIndexGroup(item: { readonly owner?: string; readonly mcpServer?: string; readonly fullTool: { readonly source?: string } }): string {
  if (item.mcpServer) return `mcp:${item.mcpServer}`;
  if (item.owner) return item.owner;
  // Legacy catalogs carry semantic sources; entry paths are diagnostics, never domains.
  const source = item.fullTool.source?.trim();
  if (source?.startsWith('plugin:')) return source.slice('plugin:'.length) || TOOL_INDEX_UNGROUPED;
  if (source?.startsWith('builtin:') || source?.startsWith('mcp:')) return source;
  return TOOL_INDEX_UNGROUPED;
}

const byName = (a: CatalogEntry, b: CatalogEntry): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The parts of a skill description the catalog keeps (#1250 b27). */
export interface SkillCatalogParts {
  /** First sentence, unless that sentence is itself a `Use when` / `Triggers` clause. */
  readonly summary: string;
  /** First `Use when …` / `Use for …` / `适用于…` sentence, if any. */
  readonly useWhen: string;
  /** `Triggers:` words from the description, then frontmatter keywords; de-duplicated. */
  readonly triggers: readonly string[];
}

const USE_WHEN_PATTERN = /^(?:use (?:this )?(?:skill )?(?:when|for|if)\b|when to use\b|适用于|适用场景|使用场景|何时使用)/iu;
const TRIGGERS_PATTERN = /(?:^|\s)(?:triggers?|trigger words|keywords|触发词|触发方式|触发|关键词)\s*[:：]\s*/iu;
const TRIGGER_SEPARATOR = /\s*[,，、;；|/]\s*/u;

/** Sentences of a whitespace-collapsed description (CJK and Latin sentence ends). */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest) {
    const end = rest.search(/[。！？；]|[.!?;](?:\s|$)/u);
    if (end < 0) { out.push(rest.trim()); break; }
    out.push(rest.slice(0, end).trim());
    rest = rest.slice(end + 1).trim();
  }
  return out.filter(Boolean);
}

/**
 * Splits a skill description into summary, `Use when` clause and trigger words. The scaffold
 * description shape is `English summary. Use when …. Triggers: 中文触发词`; every part is optional.
 */
export function skillCatalogParts(description: string, keywords: readonly string[] = []): SkillCatalogParts {
  const flat = description.replace(/\s+/gu, ' ').trim();
  const marker = flat.match(TRIGGERS_PATTERN);
  const prose = marker?.index !== undefined ? flat.slice(0, marker.index).trim() : flat;
  const triggerText = marker?.index !== undefined ? flat.slice(marker.index + marker[0].length) : '';
  // The trigger list runs to the end of its sentence (a trailing `.` / `。` closes it).
  const triggerList = triggerText.split(/[。！？]|[.!?](?:\s|$)/u, 1)[0] ?? '';
  const sentences = sentencesOf(prose);
  const first = sentences[0] ?? '';
  const summary = USE_WHEN_PATTERN.test(first) ? '' : first;
  const useWhen = sentences.find((sentence) => USE_WHEN_PATTERN.test(sentence)) ?? '';
  const seen = new Set<string>();
  const triggers: string[] = [];
  for (const raw of [...triggerList.split(TRIGGER_SEPARATOR), ...keywords]) {
    const word = raw.replace(/\s+/gu, ' ').trim();
    const key = word.normalize('NFKC').toLocaleLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    triggers.push(word);
  }
  return { summary, useWhen, triggers };
}

/** Clips text to `max` characters, preferring a word or list boundary; '' when too short to help. */
function clipPart(text: string, max: number, list = false): string {
  if (text.length <= max) return text;
  if (max < (list ? CATALOG_TRIGGER_MIN_CHARS : CATALOG_PART_MIN_CHARS)) return '';
  let cut = text.slice(0, max - 1);
  // A trigger list keeps whole words: cut after the last complete item when there is one.
  const item = list && text[max - 1] !== ',' ? cut.lastIndexOf(', ') : -1;
  const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','), cut.lastIndexOf('，'), cut.lastIndexOf('、'));
  if (item > 0) cut = cut.slice(0, item);
  else if (boundary > max / 2 && !/[\s,，、]/u.test(text[max - 1] ?? '')) cut = cut.slice(0, boundary);
  cut = cut.replace(/[\s,，、]+$/u, '');
  return cut ? `${cut}…` : '';
}

/** Max-min fair allowances: short parts keep their length, long ones share what is left. */
function fairShares(lengths: readonly number[], budget: number): number[] {
  const shares = lengths.map(() => 0);
  let remaining = Math.max(0, budget);
  const order = lengths.map((length, index) => ({ length, index })).sort((a, b) => a.length - b.length);
  for (const [position, { length, index }] of order.entries()) {
    const share = Math.floor(remaining / (order.length - position));
    shares[index] = Math.min(length, share);
    remaining -= shares[index]!;
  }
  return shares;
}

type CatalogTier = 'summary' | 'useWhen' | 'triggers';
/** Cut first → cut last: trigger words outlive the prose that explains them. */
const CUT_ORDER: readonly CatalogTier[] = ['summary', 'useWhen', 'triggers'];
/** Separator (`: ` / ` | `) and `Triggers: ` label characters each rendered part adds. */
const PART_OVERHEAD = 3;
const TRIGGERS_LABEL = 'Triggers: ';

function renderSkillLine(name: string, parts: Readonly<Record<CatalogTier, string>>): string {
  const rendered = [parts.summary, parts.useWhen, parts.triggers ? `${TRIGGERS_LABEL}${parts.triggers}` : '']
    .filter(Boolean);
  return rendered.length ? `- ${name}: ${rendered.join(' | ')}` : `- ${name}`;
}

/** Shrinks the parts tier by tier until their rendered text fits `max` characters. */
function fitTiers(
  entries: readonly Readonly<Record<CatalogTier, string>>[],
  fixed: number,
  max: number,
): Readonly<Record<CatalogTier, string>>[] {
  const size = (text: string, tier: CatalogTier) => (text ? text.length + PART_OVERHEAD + (tier === 'triggers' ? TRIGGERS_LABEL.length : 0) : 0);
  let current = entries.map((entry) => ({ ...entry }));
  const total = () => fixed + current.reduce((sum, entry) => sum + CUT_ORDER.reduce((part, tier) => part + size(entry[tier], tier), 0), 0);
  for (const tier of CUT_ORDER) {
    const over = total() - max;
    if (over <= 0) break;
    const lengths = current.map((entry) => entry[tier].length);
    const available = lengths.reduce((sum, length) => sum + length, 0) - over;
    const shares = fairShares(lengths, available);
    current = current.map((entry, index) => {
      const share = shares[index]!;
      if (share >= entry[tier].length) return entry;
      // A dropped part also frees its separator; a clipped one keeps it.
      return { ...entry, [tier]: clipPart(entry[tier], share, tier === 'triggers') };
    });
  }
  return current;
}

function entryTiers(skill: CatalogEntry): Readonly<Record<CatalogTier, string>> {
  const parts = skillCatalogParts(skill.description, skill.keywords);
  const tiers = { summary: parts.summary, useWhen: parts.useWhen, triggers: parts.triggers.join(', ') };
  // `- name` plus the newline that joins it to the block.
  return fitTiers([tiers], skill.name.length + 3, SKILL_CATALOG_ENTRY_MAX_CHARS)[0]!;
}

/** One skill catalog line (`- name: summary | Use when … | Triggers: …`), clipped to the entry limit. */
export function formatSkillCatalogEntry(skill: CatalogEntry): string {
  return renderSkillLine(skill.name, entryTiers(skill));
}

/**
 * Skill catalog block: name, summary, `Use when` clause and trigger words (description
 * `Triggers:` plus frontmatter `keywords`) per skill, within {@link SKILL_CATALOG_BUDGET_CHARS}.
 * When the budget runs out summaries are clipped first and trigger words last (#1250 b27).
 * Sorted by name so the block is byte-stable across turns; the full description arrives with
 * load_skill / discover.
 */
export function renderSkillCatalog(
  skills: readonly CatalogEntry[],
  budget = SKILL_CATALOG_BUDGET_CHARS,
): string | undefined {
  if (skills.length === 0) return undefined;
  const sorted = [...skills].sort(byName);
  const listed = sorted.slice(0, CATALOG_MAX_ENTRIES);
  const perEntry = listed.map(entryTiers);
  const fixed = listed.reduce((sum, skill) => sum + skill.name.length + 3, 0);
  const fitted = fitTiers(perEntry, fixed, budget);
  const lines = listed.map((skill, index) => renderSkillLine(skill.name, fitted[index]!));
  const hidden = sorted.length - listed.length;
  if (hidden > 0) lines.push(`- …and ${hidden} more; use discover(kind=skill) to search them.`);
  return [SKILL_CATALOG_HEADING, ...lines].join('\n');
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
