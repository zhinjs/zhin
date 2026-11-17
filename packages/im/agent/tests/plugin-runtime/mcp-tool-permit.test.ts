import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MCP_TOOL_PERMIT,
  bindingMcpPermits,
  combineMcpPermitValues,
  isMcpToolDeclaredReadOnly,
  matchMcpToolRules,
  mcpServerPermitsFromConfig,
  parseAgentMcpServers,
  parseMcpPermitValue,
  parseMcpToolPermit,
  resolveMcpPermitLayer,
  resolveMcpToolPermit,
  type McpToolPermit,
} from '../../src/plugin-runtime/mcp-tool-permit.js';

const permit = (raw: unknown): McpToolPermit => parseMcpToolPermit(raw, 'ai.mcpServers[0].permit')!;

describe('ADR 0065 permit values (D2)', () => {
  it('accepts the reserved words, one DSL string and a DSL list', () => {
    expect(parseMcpPermitValue('everyone', 'x')).toBe('everyone');
    expect(parseMcpPermitValue('deny', 'x')).toBe('deny');
    expect(parseMcpPermitValue('owner@global', 'x')).toEqual(['owner@global']);
    expect(parseMcpPermitValue(['owner@global', 'private(*)'], 'x')).toEqual(['owner@global', 'private(*)']);
    expect(parseMcpPermitValue('role(owner@global,admin@adapter)', 'x')).toEqual(['role(owner@global,admin@adapter)']);
    expect(parseMcpPermitValue('platform:admin', 'x')).toEqual(['platform:admin']);
  });

  it('rejects reserved words inside a list, empty lists and bad DSL', () => {
    expect(() => parseMcpPermitValue(['everyone'], 'p')).toThrow('"everyone" must stand alone');
    expect(() => parseMcpPermitValue(['owner@global', 'deny'], 'p')).toThrow('"deny" must stand alone');
    expect(() => parseMcpPermitValue([], 'p')).toThrow(/empty array.*everyone/u);
    expect(() => parseMcpPermitValue('', 'p')).toThrow('must not be empty');
    expect(() => parseMcpPermitValue([''], 'p')).toThrow('non-empty permit string');
    expect(() => parseMcpPermitValue([1], 'p')).toThrow('non-empty permit string');
    expect(() => parseMcpPermitValue(true, 'p')).toThrow('must be "everyone", "deny"');
    // Removed spellings point at their replacement (assertPermitSyntax).
    expect(() => parseMcpPermitValue('master', 'p')).toThrow(/removed.*owner/u);
    expect(() => parseMcpPermitValue(['scene_admin'], 'p')).toThrow(/removed.*platform:admin/u);
    expect(() => parseMcpPermitValue('Everyone', 'p')).toThrow('Unknown permit');
    expect(() => parseMcpPermitValue('owner@planet', 'p')).toThrow('Unknown permit');
  });

  it('allows only readOnly / default / tools and rejects duplicate patterns', () => {
    expect(parseMcpToolPermit(undefined, 'p')).toBeUndefined();
    expect(parseMcpToolPermit(null, 'p')).toBeUndefined();
    expect(permit({})).toEqual({});
    expect(permit({ readOnly: 'trusted', default: 'deny', tools: { 'create_*': 'deny', get_me: ['trusted'] } })).toEqual({
      readOnly: ['trusted'], default: 'deny', tools: { 'create_*': 'deny', get_me: ['trusted'] },
    });
    expect(() => permit({ readonly: 'everyone' })).toThrow('readonly is not supported');
    expect(() => permit([])).toThrow('must be an object');
    expect(() => permit('everyone')).toThrow('must be an object');
    expect(() => permit({ tools: ['a'] })).toThrow('tools must be an object');
    expect(() => permit({ tools: { '': 'everyone' } })).toThrow('empty tool name');
    expect(() => permit({ tools: { ' get_me': 'everyone' } })).toThrow('surrounding whitespace');
    expect(() => permit({ tools: { 'a*': 'everyone', 'a**': 'deny' } })).toThrow('repeats the pattern');
    expect(() => permit({ tools: { get_me: [] } })).toThrow('empty array');
    expect(() => permit({ default: ['deny'] })).toThrow('must stand alone');
  });

  it('keeps a __proto__ tool name as an own rule', () => {
    const parsed = permit(JSON.parse('{"tools":{"__proto__":"deny"}}'));
    expect(matchMcpToolRules(parsed.tools, '__proto__')).toEqual(['__proto__']);
    expect(resolveMcpToolPermit({ server: parsed }, { name: '__proto__' })).toMatchObject({ status: 'denied' });
  });
});

describe('D7 tool name matching', () => {
  const tools = permit({ tools: {
    create_issue: 'trusted',
    'create_*': 'deny',
    '*_issue': 'owner@global',
    'get_*': 'everyone',
    'get_*e': 'trusted',
    'list_*': 'admin',
    '*_list': ['owner@global'],
    'search_*': 'everyone',
    '工具': 'everyone',
    '*': 'admin',
  } }).tools;

  it('prefers the exact name over every pattern', () => {
    expect(matchMcpToolRules(tools, 'create_issue')).toEqual(['create_issue']);
  });

  it('otherwise takes the pattern with the most literal characters', () => {
    // create_* (7 literals) beats *_issue (6).
    expect(matchMcpToolRules(tools, 'create_repo_issue')).toEqual(['create_*']);
    expect(matchMcpToolRules(tools, 'delete_issue')).toEqual(['*_issue']);
    expect(matchMcpToolRules(tools, 'get_me')).toEqual(['get_*e']);
    expect(matchMcpToolRules(tools, 'get_user')).toEqual(['get_*']);
    expect(matchMcpToolRules(tools, 'other')).toEqual(['*']);
    expect(matchMcpToolRules(undefined, 'other')).toEqual([]);
  });

  it('combines equally specific patterns with AND (any deny denies)', () => {
    // list_* and *_list both have 5 literal characters.
    expect(matchMcpToolRules(tools, 'list_x_list')).toEqual(['list_*', '*_list']);
    expect(resolveMcpPermitLayer(permit({ tools }), { name: 'list_x_list' }, 'server')).toEqual({
      value: ['admin', 'owner@global'], rules: ['tools:list_*', 'tools:*_list'],
    });
    const tie = permit({ tools: { 'a_*': 'everyone', '*_b': 'deny' } });
    expect(resolveMcpToolPermit({ server: tie }, { name: 'a_b' })).toMatchObject({ status: 'denied' });
  });

  it('is case-sensitive and does not normalize', () => {
    expect(matchMcpToolRules(tools, 'Get_me')).toEqual(['*']);
    expect(matchMcpToolRules(tools, 'ＧＥＴ_me')).toEqual([]);
    const exact = permit({ tools: { Search: 'deny' } }).tools;
    expect(matchMcpToolRules(exact, 'search')).toEqual([]);
  });

  it('matches non-ASCII names only by their exact name', () => {
    expect(matchMcpToolRules(tools, '工具')).toEqual(['工具']);
    // A homoglyph of search_x (Cyrillic "ѕ") never borrows the search_* or * rule.
    expect(matchMcpToolRules(tools, 'ѕearch_x')).toEqual([]);
    expect(matchMcpToolRules(tools, 'search_é')).toEqual([]);
    expect(matchMcpToolRules(permit({ tools: { '工*': 'everyone' } }).tools, '工具')).toEqual([]);
    expect(resolveMcpToolPermit(undefined, { name: 'ѕearch_x', hints: { readOnly: false } })).toEqual({
      status: 'allowed', permissions: ['owner@global'], rules: ['server:default'],
    });
  });

  it('treats * as any run of characters, including none', () => {
    const star = permit({ tools: { 'get*': 'everyone', 'a.b*': 'deny' } }).tools;
    expect(matchMcpToolRules(star, 'get')).toEqual(['get*']);
    expect(matchMcpToolRules(star, 'get\nx')).toEqual(['get*']);
    // Regex characters in a pattern are literal.
    expect(matchMcpToolRules(star, 'axbc')).toEqual([]);
    expect(matchMcpToolRules(star, 'a.bc')).toEqual(['a.b*']);
  });
});

describe('D3 default tiers', () => {
  it('opens declared read-only tools to everyone and keeps the rest for the global owner', () => {
    expect(DEFAULT_MCP_TOOL_PERMIT).toEqual({ readOnly: 'everyone', default: ['owner@global'] });
    expect(resolveMcpToolPermit(undefined, { name: 'list_issues', hints: { readOnly: true } })).toEqual({
      status: 'allowed', permissions: [], rules: ['server:readOnly'],
    });
    expect(resolveMcpToolPermit(undefined, { name: 'create_issue' })).toEqual({
      status: 'allowed', permissions: ['owner@global'], rules: ['server:default'],
    });
    expect(resolveMcpToolPermit({}, { name: 'create_issue', hints: { readOnly: false } })).toMatchObject({ permissions: ['owner@global'] });
  });

  it('treats readOnly + destructive as "may write"', () => {
    expect(isMcpToolDeclaredReadOnly({ readOnly: true, destructive: true })).toBe(false);
    expect(isMcpToolDeclaredReadOnly({ readOnly: true, destructive: false })).toBe(true);
    expect(isMcpToolDeclaredReadOnly({ destructive: false })).toBe(false);
    expect(isMcpToolDeclaredReadOnly(undefined)).toBe(false);
    expect(resolveMcpToolPermit(undefined, { name: 'wipe', hints: { readOnly: true, destructive: true } })).toMatchObject({
      permissions: ['owner@global'], rules: ['server:default'],
    });
  });

  it('applies the three steps in order: tools, then readOnly, then default', () => {
    const server = permit({ readOnly: 'trusted', default: 'admin', tools: { dangerous_read: 'owner@global' } });
    expect(resolveMcpToolPermit({ server }, { name: 'dangerous_read', hints: { readOnly: true } })).toMatchObject({
      permissions: ['owner@global'], rules: ['server:tools:dangerous_read'],
    });
    expect(resolveMcpToolPermit({ server }, { name: 'list', hints: { readOnly: true } })).toMatchObject({ permissions: ['trusted'] });
    expect(resolveMcpToolPermit({ server }, { name: 'create' })).toMatchObject({ permissions: ['admin'] });
    // Omitted keys still take the D3 defaults on the server layer.
    const onlyTools = permit({ tools: { get_me: 'trusted' } });
    expect(resolveMcpToolPermit({ server: onlyTools }, { name: 'list', hints: { readOnly: true } })).toMatchObject({ permissions: [] });
    expect(resolveMcpToolPermit({ server: onlyTools }, { name: 'create' })).toMatchObject({ permissions: ['owner@global'] });
  });

  it('denies with deny and with a whitelist of default: deny', () => {
    const whitelist = permit({ default: 'deny', readOnly: 'deny', tools: { 'get_*': 'everyone' } });
    expect(resolveMcpToolPermit({ server: whitelist }, { name: 'get_me' })).toMatchObject({ status: 'allowed', permissions: [] });
    expect(resolveMcpToolPermit({ server: whitelist }, { name: 'list', hints: { readOnly: true } })).toMatchObject({ status: 'denied' });
    expect(resolveMcpToolPermit({ server: whitelist }, { name: 'create' })).toMatchObject({ status: 'denied' });
  });
});

describe('Agent layer (D2.4): AND with the server layer, only narrows', () => {
  const server = permit({ tools: { 'search_*': 'everyone' } });

  it('cannot widen a server-level owner-only tool', () => {
    const agent = parseMcpToolPermit({ default: 'everyone', readOnly: 'everyone', tools: { create_issue: 'everyone' } }, 'agent')!;
    expect(resolveMcpToolPermit({ server, agent }, { name: 'create_issue' })).toEqual({
      status: 'allowed', permissions: ['owner@global'], rules: ['server:default', 'agent:tools:create_issue'],
    });
  });

  it('narrows with deny or an extra permit', () => {
    const agent = parseMcpToolPermit({ default: 'deny', tools: { get_me: 'everyone', 'search_*': 'trusted' } }, 'agent')!;
    expect(resolveMcpToolPermit({ server, agent }, { name: 'create_issue' })).toMatchObject({ status: 'denied' });
    expect(resolveMcpToolPermit({ server, agent }, { name: 'search_code' })).toMatchObject({ permissions: ['trusted'] });
    expect(resolveMcpToolPermit({ server, agent }, { name: 'get_me', hints: { readOnly: true } })).toMatchObject({ permissions: [] });
    expect(resolveMcpToolPermit({ server: permit({ tools: { x: 'deny' } }), agent: parseMcpToolPermit({ tools: { x: 'everyone' } }, 'a') },
      { name: 'x' })).toMatchObject({ status: 'denied' });
  });

  it('treats omitted Agent keys as everyone, not as the D3 defaults', () => {
    const agent = parseMcpToolPermit({ tools: { other: 'deny' } }, 'agent')!;
    expect(resolveMcpPermitLayer(agent, { name: 'create' }, 'agent')).toEqual({ value: 'everyone', rules: ['default'] });
    expect(resolveMcpToolPermit({ server: permit({ default: 'trusted' }), agent }, { name: 'create' })).toMatchObject({ permissions: ['trusted'] });
  });

  it('combines lists without duplicates', () => {
    expect(combineMcpPermitValues(['everyone', ['a'], ['a', 'b']])).toEqual(['a', 'b']);
    expect(combineMcpPermitValues(['everyone', 'everyone'])).toBe('everyone');
    expect(combineMcpPermitValues([['a'], 'deny'])).toBe('deny');
  });
});

describe('ai.agents.<name>.mcpServers entries', () => {
  it('accepts names and { name, permit } objects', () => {
    const parsed = parseAgentMcpServers(['github', { name: 'fs', permit: { default: 'deny' } }, { name: 'web' }], 'ai.agents.helper');
    expect(parsed.names).toEqual(['github', 'fs', 'web']);
    expect(parsed.permits).toEqual({ fs: { default: 'deny' } });
    expect(parseAgentMcpServers(undefined, 'a')).toEqual({ names: [], permits: {} });
  });

  it('rejects duplicates, bad entries and unknown keys', () => {
    expect(() => parseAgentMcpServers(['github', { name: 'github' }], 'ai.agents.helper')).toThrow('"github" is listed more than once');
    expect(() => parseAgentMcpServers(['a', 'a'], 'ai.agents.helper')).toThrow('listed more than once');
    expect(() => parseAgentMcpServers([{ name: 'a', allow: [] }], 'ai.agents.helper')).toThrow('allow is not supported');
    expect(() => parseAgentMcpServers([{ permit: {} }], 'ai.agents.helper')).toThrow('empty mcpServers entry');
    expect(() => parseAgentMcpServers([' a'], 'ai.agents.helper')).toThrow('surrounding whitespace');
    expect(() => parseAgentMcpServers([1], 'ai.agents.helper')).toThrow('server name or { name, permit }');
    expect(() => parseAgentMcpServers('a', 'ai.agents.helper')).toThrow('invalid mcpServers');
    expect(() => parseAgentMcpServers([{ name: 'a', permit: { default: [] } }], 'ai.agents.helper')).toThrow('empty array');
  });

  it('builds per-server layers for a binding', () => {
    const server = mcpServerPermitsFromConfig([
      { name: 'github', permit: { tools: { 'create_*': 'deny' } } },
      { name: 'fs' },
      { name: '  ' },
      'bad',
    ]);
    expect(server).toEqual({ github: { tools: { 'create_*': 'deny' } }, fs: undefined });
    expect(() => mcpServerPermitsFromConfig([{ name: 'x', permit: { default: ['everyone'] } }])).toThrow('ai.mcpServers[0].permit.default');
    const binding = bindingMcpPermits(['github', 'fs', 'plugin-mcp'], server, { fs: { default: 'deny' } });
    expect(binding).toEqual({
      github: { server: { tools: { 'create_*': 'deny' } } },
      fs: { agent: { default: 'deny' } },
      'plugin-mcp': {},
    });
  });
});
