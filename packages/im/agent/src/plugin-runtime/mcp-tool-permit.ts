/**
 * ADR 0065: who may use each MCP tool. Pure functions only — parsing and validating the
 * `permit` config, matching tool-name rules (D7) and assigning a tool its tier (D2/D3).
 * The resulting permit list is checked by the same `PermissionHost` gate as plugin tools.
 */
import { assertPermitSyntax } from '@zhin.js/permission';
import type { McpToolHints } from '@zhin.js/mcp-feature';

/** Reserved word: everyone may use the tool (same as a plugin tool without `permissions`). */
export const MCP_PERMIT_EVERYONE = 'everyone';
/** Reserved word: nobody may use the tool; it is never expanded. */
export const MCP_PERMIT_DENY = 'deny';

/**
 * One tier: `everyone`, `deny`, or a non-empty list of permit DSL strings that must all hold (AND).
 * A single DSL string in config is normalized to a one-item list.
 */
export type McpPermitValue = typeof MCP_PERMIT_EVERYONE | typeof MCP_PERMIT_DENY | readonly string[];

/** Parsed `permit` of an `ai.mcpServers[]` entry or of an `ai.agents.<name>.mcpServers[]` object. */
export interface McpToolPermit {
  /** Tools the server annotated `readOnlyHint: true` (and not destructive) that no `tools` rule matched. */
  readonly readOnly?: McpPermitValue;
  /** Every other tool (not annotated, annotated as writing, or contradictory). */
  readonly default?: McpPermitValue;
  /** Rules by upstream tool name (exact, or with `*` wildcards; D7). */
  readonly tools?: Readonly<Record<string, McpPermitValue>>;
}

/** The two layers that decide one server's tools for one Agent binding; both must allow (AND). */
export interface McpServerToolPermits {
  /** `ai.mcpServers[].permit`; absent means the D3 defaults. */
  readonly server?: McpToolPermit;
  /** `ai.agents.<name>.mcpServers[]` object form; can only narrow the server layer. */
  readonly agent?: McpToolPermit;
}

/** Per-server permits of one Agent binding, keyed by server name. */
export type McpBindingPermits = Readonly<Record<string, McpServerToolPermits>>;

/** D3 defaults of the server layer: read-only tools for everyone, the rest only for the global owner. */
export const DEFAULT_MCP_TOOL_PERMIT: Readonly<Required<Pick<McpToolPermit, 'readOnly' | 'default'>>> = Object.freeze({
  readOnly: MCP_PERMIT_EVERYONE,
  default: Object.freeze(['owner@global']),
});

const PERMIT_KEYS = new Set(['readOnly', 'default', 'tools']);

/** Where a tool's tier came from (`tools:<pattern>` / `readOnly` / `default`). */
export type McpPermitRule = `tools:${string}` | 'readOnly' | 'default';

export interface McpPermitLayerDecision {
  readonly value: McpPermitValue;
  /** Rules that decided this layer; several when equally specific patterns tie (D7). */
  readonly rules: readonly McpPermitRule[];
}

export type McpToolPermitDecision =
  | Readonly<{ status: 'denied'; rules: readonly string[] }>
  | Readonly<{ status: 'allowed'; permissions: readonly string[]; rules: readonly string[] }>;

/** Whether the upstream annotations put a tool in the `readOnly` tier (D1.4 / D3.2). */
export function isMcpToolDeclaredReadOnly(hints: McpToolHints | undefined): boolean {
  return hints?.readOnly === true && hints.destructive !== true;
}

/**
 * Parses one permit value (`everyone`, `deny`, a DSL string, or a non-empty DSL array).
 * Throws a TypeError naming `source` for any configuration error.
 */
export function parseMcpPermitValue(raw: unknown, source: string): McpPermitValue {
  if (raw === MCP_PERMIT_EVERYONE || raw === MCP_PERMIT_DENY) return raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) throw new TypeError(`${source} must not be empty`);
    assertPermitSyntax([raw], source);
    return Object.freeze([raw]);
  }
  if (Array.isArray(raw)) {
    if (!raw.length) {
      throw new TypeError(`${source} must not be an empty array; write "${MCP_PERMIT_EVERYONE}" to allow everyone`);
    }
    for (const [index, item] of raw.entries()) {
      if (typeof item !== 'string' || !item.trim()) throw new TypeError(`${source}[${index}] must be a non-empty permit string`);
      if (item === MCP_PERMIT_EVERYONE || item === MCP_PERMIT_DENY) {
        throw new TypeError(`${source}[${index}]: "${item}" must stand alone, not inside a list`);
      }
    }
    assertPermitSyntax(raw as string[], source);
    return Object.freeze([...new Set(raw as string[])]);
  }
  throw new TypeError(`${source} must be "${MCP_PERMIT_EVERYONE}", "${MCP_PERMIT_DENY}", a permit string or a list of permit strings`);
}

/**
 * Parses an `ai.mcpServers[].permit` (or Agent-level) object. `undefined` / `null` mean "not set".
 * Only `readOnly`, `default` and `tools` are allowed; each may be omitted.
 */
export function parseMcpToolPermit(raw: unknown, source: string): McpToolPermit | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${source} must be an object`);
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!PERMIT_KEYS.has(key)) throw new TypeError(`${source}.${key} is not supported (expected readOnly, default or tools)`);
  }
  const permit: { readOnly?: McpPermitValue; default?: McpPermitValue; tools?: Readonly<Record<string, McpPermitValue>> } = {};
  if (record.readOnly !== undefined && record.readOnly !== null) permit.readOnly = parseMcpPermitValue(record.readOnly, `${source}.readOnly`);
  if (record.default !== undefined && record.default !== null) permit.default = parseMcpPermitValue(record.default, `${source}.default`);
  if (record.tools !== undefined && record.tools !== null) permit.tools = parseToolRules(record.tools, `${source}.tools`);
  return Object.freeze(permit);
}

function parseToolRules(raw: unknown, source: string): Readonly<Record<string, McpPermitValue>> {
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${source} must be an object of tool name → permit`);
  const rules: [string, McpPermitValue][] = [];
  const seen = new Map<string, string>();
  for (const [pattern, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!pattern) throw new TypeError(`${source} contains an empty tool name`);
    if (pattern !== pattern.trim()) throw new TypeError(`${source}."${pattern}" must not contain surrounding whitespace`);
    const canonical = canonicalPattern(pattern);
    const previous = seen.get(canonical);
    if (previous !== undefined) throw new TypeError(`${source}: "${pattern}" repeats the pattern "${previous}"`);
    seen.set(canonical, pattern);
    rules.push([pattern, parseMcpPermitValue(value, `${source}."${pattern}"`)]);
  }
  // fromEntries keeps a key such as `__proto__` as an own property.
  return Object.freeze(Object.fromEntries(rules));
}

/** `a**b` and `a*b` match the same names, so they count as the same pattern. */
function canonicalPattern(pattern: string): string {
  return pattern.replace(/\*+/gu, '*');
}

function isAscii(value: string): boolean {
  return /^[\x00-\x7f]*$/u.test(value);
}

function literalLength(pattern: string): number {
  return pattern.replaceAll('*', '').length;
}

function wildcardMatches(pattern: string, name: string): boolean {
  const source = canonicalPattern(pattern).split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*');
  return new RegExp(`^${source}$`, 'su').test(name);
}

/**
 * D7: the `tools` rules that decide `toolName`. An exact name wins; otherwise the patterns with the
 * most literal characters, all of them when several tie (their tiers are combined with AND).
 * Case-sensitive, no normalization; `*` is the only wildcard; a name with any non-ASCII character
 * is only matched by its exact name.
 */
export function matchMcpToolRules(
  tools: Readonly<Record<string, McpPermitValue>> | undefined,
  toolName: string,
): readonly string[] {
  if (!tools) return Object.freeze([]);
  if (Object.hasOwn(tools, toolName) && !toolName.includes('*')) return Object.freeze([toolName]);
  if (!isAscii(toolName)) return Object.freeze([]);
  let best = -1;
  let matched: string[] = [];
  for (const pattern of Object.keys(tools)) {
    if (!pattern.includes('*') || !wildcardMatches(pattern, toolName)) continue;
    const length = literalLength(pattern);
    if (length > best) {
      best = length;
      matched = [pattern];
    } else if (length === best) {
      matched.push(pattern);
    }
  }
  return Object.freeze(matched);
}

/** AND of several tiers: any `deny` denies; `everyone` adds nothing; DSL lists are concatenated. */
export function combineMcpPermitValues(values: readonly McpPermitValue[]): McpPermitValue {
  if (values.some((value) => value === MCP_PERMIT_DENY)) return MCP_PERMIT_DENY;
  const permits = [...new Set(values.flatMap((value) => (value === MCP_PERMIT_EVERYONE ? [] : value as readonly string[])))];
  return permits.length ? Object.freeze(permits) : MCP_PERMIT_EVERYONE;
}

/**
 * Tier of one tool within one layer (D2.3): a matching `tools` rule, else `readOnly` for a tool the
 * server declared read-only, else `default`. The server layer fills omitted keys with the D3
 * defaults; the Agent layer treats them as `everyone` because the server layer already decided.
 */
export function resolveMcpPermitLayer(
  permit: McpToolPermit | undefined,
  tool: Readonly<{ name: string; hints?: McpToolHints }>,
  layer: 'server' | 'agent',
): McpPermitLayerDecision {
  const matched = matchMcpToolRules(permit?.tools, tool.name);
  if (matched.length) {
    return Object.freeze({
      value: combineMcpPermitValues(matched.map((pattern) => permit!.tools![pattern]!)),
      rules: Object.freeze(matched.map((pattern) => `tools:${pattern}` as const)),
    });
  }
  const fallback = layer === 'server' ? DEFAULT_MCP_TOOL_PERMIT : undefined;
  if (isMcpToolDeclaredReadOnly(tool.hints)) {
    return Object.freeze({ value: permit?.readOnly ?? fallback?.readOnly ?? MCP_PERMIT_EVERYONE, rules: Object.freeze(['readOnly' as const]) });
  }
  return Object.freeze({ value: permit?.default ?? fallback?.default ?? MCP_PERMIT_EVERYONE, rules: Object.freeze(['default' as const]) });
}

/**
 * Final decision for one tool of one server (D2.4/D2.5): the server layer AND the Agent layer.
 * `allowed.permissions` is what the tool carries into `PermissionHost.checkAll` (empty = everyone).
 */
export function resolveMcpToolPermit(
  permits: McpServerToolPermits | undefined,
  tool: Readonly<{ name: string; hints?: McpToolHints }>,
): McpToolPermitDecision {
  const server = resolveMcpPermitLayer(permits?.server, tool, 'server');
  const layers = [server];
  const rules: string[] = server.rules.map((rule) => `server:${rule}`);
  if (permits?.agent) {
    const agent = resolveMcpPermitLayer(permits.agent, tool, 'agent');
    layers.push(agent);
    rules.push(...agent.rules.map((rule) => `agent:${rule}`));
  }
  const value = combineMcpPermitValues(layers.map((layer) => layer.value));
  if (value === MCP_PERMIT_DENY) return Object.freeze({ status: 'denied', rules: Object.freeze(rules) });
  return Object.freeze({
    status: 'allowed',
    permissions: value === MCP_PERMIT_EVERYONE ? Object.freeze([]) : value as readonly string[],
    rules: Object.freeze(rules),
  });
}

export interface ParsedAgentMcpServers {
  /** Server names in declaration order (what the binding exposes). */
  readonly names: readonly string[];
  /** Agent-layer permits of the object entries, keyed by server name. */
  readonly permits: Readonly<Record<string, McpToolPermit>>;
}

/**
 * Parses `ai.agents.<name>.mcpServers`: each entry is a server name or `{ name, permit }`.
 * A server may appear only once per Agent. Throws a TypeError for any configuration error.
 */
export function parseAgentMcpServers(raw: unknown, source: string): ParsedAgentMcpServers {
  if (raw === undefined || raw === null) return Object.freeze({ names: Object.freeze([]), permits: Object.freeze({}) });
  if (!Array.isArray(raw)) throw new TypeError(`${source}: invalid mcpServers`);
  const names: string[] = [];
  const permits: [string, McpToolPermit][] = [];
  for (const [index, entry] of raw.entries()) {
    const where = `${source}.mcpServers[${index}]`;
    let name: unknown;
    let permit: McpToolPermit | undefined;
    if (typeof entry === 'string') {
      name = entry;
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (key !== 'name' && key !== 'permit') throw new TypeError(`${where}.${key} is not supported (expected name and permit)`);
      }
      name = record.name;
      permit = parseMcpToolPermit(record.permit, `${where}.permit`);
    } else {
      throw new TypeError(`${where} must be a server name or { name, permit }`);
    }
    if (typeof name !== 'string' || !name.trim()) throw new TypeError(`${source}: empty mcpServers entry`);
    if (name !== name.trim()) throw new TypeError(`${source}: MCP server names must not contain surrounding whitespace`);
    if (names.includes(name)) throw new TypeError(`${source}: MCP server "${name}" is listed more than once`);
    names.push(name);
    if (permit) permits.push([name, permit]);
  }
  return Object.freeze({ names: Object.freeze(names), permits: Object.freeze(Object.fromEntries(permits)) });
}

/**
 * Per-server permits of one binding: the server layer from `ai.mcpServers[].permit` and the Agent
 * layer from the binding's object entries. Only the binding's own servers are listed.
 */
export function bindingMcpPermits(
  serverNames: readonly string[],
  serverPermits: Readonly<Record<string, McpToolPermit | undefined>>,
  agentPermits: Readonly<Record<string, McpToolPermit>>,
): McpBindingPermits {
  return Object.freeze(Object.fromEntries(serverNames.map((name) => {
    const server = Object.hasOwn(serverPermits, name) ? serverPermits[name] : undefined;
    const agent = Object.hasOwn(agentPermits, name) ? agentPermits[name] : undefined;
    return [name, Object.freeze({ ...(server ? { server } : {}), ...(agent ? { agent } : {}) })];
  })));
}

/**
 * Server-layer permits of `ai.mcpServers`, keyed by server name. Entries without a usable name are
 * skipped (the server list validation reports them). Throws for an invalid `permit`.
 */
export function mcpServerPermitsFromConfig(servers: unknown): Readonly<Record<string, McpToolPermit | undefined>> {
  if (!Array.isArray(servers)) return Object.freeze({});
  const entries: [string, McpToolPermit | undefined][] = [];
  for (const [index, server] of servers.entries()) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) continue;
    const { name, permit } = server as { name?: unknown; permit?: unknown };
    if (typeof name !== 'string' || !name.trim()) continue;
    entries.push([name.trim(), parseMcpToolPermit(permit, `ai.mcpServers[${index}].permit`)]);
  }
  return Object.freeze(Object.fromEntries(entries));
}
