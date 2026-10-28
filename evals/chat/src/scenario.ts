/** Scenario files: one chat situation each, with what a good reply must (not) do. */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export interface ScenarioExpectation {
  /** true: the bot should stay quiet (no messages); false: it should reply. Omitted: either is fine. */
  readonly silent?: boolean;
  /** At most this many chat messages (default 3). */
  readonly maxMessages?: number;
  /** At most this many characters across all messages. */
  readonly maxChars?: number;
  /** Substrings that must not appear, on top of the global list. */
  readonly forbid?: readonly string[];
  /** At least one message must contain one of these. */
  readonly mustMention?: readonly string[];
  /** Segment type that must appear (e.g. `mention`). */
  readonly segment?: string;
  /** Scenario-specific criteria the judge checks one by one. */
  readonly rubric?: readonly string[];
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly scope: 'group' | 'private';
  /** false: nobody addressed the bot (an ambient turn). Default true. */
  readonly addressed: boolean;
  readonly sender: { readonly id: string; readonly name: string; readonly master?: boolean };
  /** Earlier chat lines shown as background events, e.g. `阿明 (1001): 早` or `You (this bot): 早啊`. */
  readonly context: readonly string[];
  readonly message: string;
  /** Pinned user observation time for time-of-day scenarios, e.g. `2026/10/23 03:10:00 (Asia/Shanghai)`. */
  readonly time?: string;
  readonly expect: ScenarioExpectation;
}

export function parseScenarios(text: string, source = 'scenarios'): Scenario[] {
  const raw = parse(text) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${source}: expected a list of scenarios`);
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const where = `${source}[${index}]`;
    if (!item || typeof item !== 'object') throw new Error(`${where}: expected an object`);
    const value = item as Record<string, any>;
    const id = requireString(value.id, `${where}.id`);
    if (seen.has(id)) throw new Error(`${where}: duplicate id ${id}`);
    seen.add(id);
    const scope = value.scope ?? 'group';
    if (scope !== 'group' && scope !== 'private') throw new Error(`${where}.scope must be group or private`);
    const sender = value.sender ?? {};
    return {
      id,
      title: requireString(value.title ?? id, `${where}.title`),
      tags: stringList(value.tags, `${where}.tags`),
      scope,
      addressed: value.addressed !== false,
      sender: {
        id: String(sender.id ?? '2100001'),
        name: String(sender.name ?? '小林'),
        ...(sender.master === true ? { master: true } : {}),
      },
      context: stringList(value.context, `${where}.context`),
      message: requireString(value.message, `${where}.message`),
      ...(value.time ? { time: String(value.time) } : {}),
      expect: {
        ...(typeof value.expect?.silent === 'boolean' ? { silent: value.expect.silent } : {}),
        ...(typeof value.expect?.maxMessages === 'number' ? { maxMessages: value.expect.maxMessages } : {}),
        ...(typeof value.expect?.maxChars === 'number' ? { maxChars: value.expect.maxChars } : {}),
        ...(value.expect?.forbid ? { forbid: stringList(value.expect.forbid, `${where}.expect.forbid`) } : {}),
        ...(value.expect?.mustMention ? { mustMention: stringList(value.expect.mustMention, `${where}.expect.mustMention`) } : {}),
        ...(typeof value.expect?.segment === 'string' ? { segment: value.expect.segment } : {}),
        ...(value.expect?.rubric ? { rubric: stringList(value.expect.rubric, `${where}.expect.rubric`) } : {}),
      },
    } satisfies Scenario;
  });
}

export function loadScenarios(path: string): Scenario[] {
  return parseScenarios(readFileSync(path, 'utf8'), path);
}

/** `--only` matches an id or a tag. */
export function selectScenarios(scenarios: readonly Scenario[], only: readonly string[]): Scenario[] {
  if (only.length === 0) return [...scenarios];
  return scenarios.filter(scenario => only.some(term => scenario.id === term || scenario.tags.includes(term)));
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${where} must be a non-empty string`);
  return value;
}

function stringList(value: unknown, where: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${where} must be a list of strings`);
  return value as string[];
}
