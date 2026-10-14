import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  collectRoomDefinitionIssues,
  RoomDefinitionError,
  validateRoomDefinitions,
} from '../../src/room/validate-room.js';
import { ROOM_CONVERSATION_KINDS, ROOM_MAX_MEMBERS, ROOM_RESERVED_NAMES } from '../../src/room/room-definition.js';

const bot = (n: string) => ({ adapter: 'qq', endpoint: n });
const minimal = (): any => ({
  dev: {
    name: 'Dev',
    conversation: { adapter: 'qq', endpoint: 'main', kind: 'group', id: '100' },
    roles: { worker: { prompt: 'work' } },
    members: [{ agent: 'a1', role: 'worker', botEndpoint: bot('b1') }],
  },
});
const full = (): any => ({
  dev: {
    name: 'Dev',
    description: 'd',
    enabled: true,
    conversation: { adapter: 'qq', endpoint: 'main', kind: 'group', id: '100' },
    coordinator: 'lead',
    roles: {
      coordinator: { prompt: 'p', handoffTo: ['researcher', 'writer'] },
      researcher: { prompt: 'p', tools: ['web'], accepts: ['research'], handoffTo: ['writer'] },
      writer: { prompt: 'p', accepts: ['write'] },
    },
    members: [
      { agent: 'lead', role: 'coordinator', botEndpoint: bot('b1'), aliases: ['boss'] },
      { agent: 'res', role: 'researcher', botEndpoint: bot('b2') },
      { agent: 'wri', role: 'writer', botEndpoint: bot('b3') },
    ],
  },
});

function issuesOf(raw: unknown, ctx?: any): readonly string[] {
  try {
    validateRoomDefinitions(raw, ctx);
  } catch (e) {
    expect(e).toBeInstanceOf(RoomDefinitionError);
    return (e as RoomDefinitionError).issues;
  }
  throw new Error('expected throw');
}
const expectIssue = (raw: unknown, text: string, ctx?: any) =>
  expect(issuesOf(raw, ctx).some((i) => i.includes(text))).toBe(true);

describe('validateRoomDefinitions', () => {
  it('accepts minimal room, returns frozen copy, input untouched', () => {
    const raw = minimal();
    const snapshot = JSON.stringify(raw);
    const out = validateRoomDefinitions(raw);
    expect(out.dev.name).toBe('Dev');
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.dev.members[0].botEndpoint)).toBe(true);
    expect(Object.isFrozen(out.dev.roles.worker)).toBe(true);
    expect(out.dev).not.toBe(raw.dev);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it('result is deeply frozen against mutation; public constants are frozen', () => {
    const out = validateRoomDefinitions(minimal());
    expect(() => (out.dev.members as any).push({})).toThrow();
    expect(out.dev.members).toHaveLength(1);
    expect(() => { (out.dev.roles.worker as any).prompt = 'x'; }).toThrow();
    expect(out.dev.roles.worker.prompt).toBe('work');
    expect(() => { (out as any).extra = 1; }).toThrow();
    expect((out as any).extra).toBeUndefined();
    expect(Object.isFrozen(ROOM_CONVERSATION_KINDS)).toBe(true);
    expect(Object.isFrozen(ROOM_RESERVED_NAMES)).toBe(true);
    expect(() => (ROOM_CONVERSATION_KINDS as any).push('x')).toThrow();
    expect(() => (ROOM_RESERVED_NAMES as any).push('x')).toThrow();
  });

  it('rejects non-array members, duplicate accepts, non-string role description', () => {
    for (const bad of [{}, 'x']) {
      const a = minimal(); a.dev.members = bad;
      expectIssue(a, 'rooms.dev.members: required array');
    }
    const b = minimal(); b.dev.roles.worker.accepts = ['a', 'a'];
    expectIssue(b, 'rooms.dev.roles.worker.accepts.1: duplicate');
    const c = minimal(); c.dev.roles.worker.description = 5;
    expectIssue(c, 'rooms.dev.roles.worker.description: must be a string');
  });

  it('conversation ownership ignores endpoint but respects adapter', () => {
    const one = minimal().dev;
    const other = minimal().dev;
    other.conversation.endpoint = 'other';
    other.members[0].botEndpoint = bot('b2');
    expectIssue({ one, two: other }, 'already owned by room "one"');
    const onebot = minimal().dev;
    onebot.conversation.adapter = 'onebot';
    onebot.members[0].botEndpoint = { adapter: 'onebot', endpoint: 'b2' };
    expect(() => validateRoomDefinitions({ one: minimal().dev, two: onebot })).not.toThrow();
    const disabled = minimal().dev;
    disabled.enabled = false;
    expect(() => validateRoomDefinitions({ one: minimal().dev, two: disabled })).not.toThrow();
  });

  it('member bot adapter must match room conversation adapter', () => {
    const a = minimal(); a.dev.members[0].botEndpoint = { adapter: 'onebot', endpoint: 'b1' };
    expectIssue(a, 'rooms.dev.members.0.botEndpoint.adapter: bot adapter "onebot" must match');
    expect(() => validateRoomDefinitions(minimal())).not.toThrow();
  });

  it('agent names are unique case-insensitively', () => {
    const a = minimal();
    a.dev.members = [
      { agent: 'Lead', role: 'worker', botEndpoint: bot('b1') },
      { agent: 'lead', role: 'worker', botEndpoint: bot('b2') },
    ];
    expectIssue(a, 'rooms.dev.members.1.agent: agent "lead" conflicts case-insensitively');
    expect(issuesOf(a).some((i) => i.includes('duplicate agent'))).toBe(false);
    const b = minimal();
    b.dev.members.push({ agent: 'a1', role: 'worker', botEndpoint: bot('b2') });
    expectIssue(b, 'rooms.dev.members.1.agent: duplicate agent "a1"');
  });

  it('accepts full room without reviewer, and without coordinator', () => {
    expect(validateRoomDefinitions(full()).dev.coordinator).toBe('lead');
    const noCoord = full();
    delete noCoord.dev.coordinator;
    expect(validateRoomDefinitions(noCoord).dev.coordinator).toBeUndefined();
    expect(collectRoomDefinitionIssues(full())).toEqual([]);
  });

  it('null/undefined give {}; non-objects throw', () => {
    expect({ ...validateRoomDefinitions(null) }).toEqual({});
    expect({ ...validateRoomDefinitions(undefined) }).toEqual({});
    for (const bad of [[], 'x', 1]) expect(() => validateRoomDefinitions(bad)).toThrow(RoomDefinitionError);
  });

  it('rejects invalid room id and prototype-ish names', () => {
    const r = minimal();
    expectIssue({ 'Bad Id': r.dev }, 'rooms.Bad Id: invalid room id');
    expectIssue(JSON.parse(`{"__proto__": ${JSON.stringify(r.dev)}}`), 'invalid room id "__proto__"');
    expectIssue({ constructor: r.dev }, 'invalid room id "constructor"');
    const c = minimal();
    c.dev.roles = { constructor: { prompt: 'p' }, prototype: { prompt: 'p' }, worker: { prompt: 'p' } };
    expectIssue(c, 'rooms.dev.roles.constructor: invalid role name');
    expectIssue(c, 'rooms.dev.roles.prototype: invalid role name');
    const p = minimal();
    p.dev.roles = JSON.parse('{"__proto__": {"prompt": "p"}, "worker": {"prompt": "p"}}');
    expectIssue(p, 'invalid role name "__proto__"');
  });

  it('rejects bad name/description/enabled', () => {
    const a = minimal(); a.dev.name = '  ';
    expectIssue(a, 'rooms.dev.name');
    const b = minimal(); b.dev.description = 1;
    expectIssue(b, 'rooms.dev.description');
    const c = minimal(); c.dev.enabled = 'yes';
    expectIssue(c, 'rooms.dev.enabled');
  });

  it('validates conversation', () => {
    const a = minimal(); delete a.dev.conversation;
    expectIssue(a, 'rooms.dev.conversation: required');
    const b = minimal(); b.dev.conversation.kind = 'repository';
    expectIssue(b, 'rooms.dev.conversation.kind');
    const c = minimal(); c.dev.conversation.id = ' 1';
    expectIssue(c, 'rooms.dev.conversation.id');
    const d = minimal(); d.dev.conversation.adapter = '';
    expectIssue(d, 'rooms.dev.conversation.adapter');
    expectIssue(minimal(), 'unknown endpoint "qq:main"', { endpointKeys: new Set(['qq:b1']) });
    const e = minimal(); e.dev.enabled = false; delete e.dev.conversation;
    expectIssue(e, 'rooms.dev.conversation: required');
  });

  it('validates roles', () => {
    const a = minimal(); a.dev.roles = {};
    expectIssue(a, 'rooms.dev.roles: must define at least one role');
    const b = minimal(); b.dev.roles.worker.prompt = ' ';
    expectIssue(b, 'rooms.dev.roles.worker.prompt');
    const c = minimal(); c.dev.roles.worker.tools = ['x', 'x', ''];
    expectIssue(c, 'rooms.dev.roles.worker.tools.1: duplicate');
    expectIssue(c, 'rooms.dev.roles.worker.tools.2');
    const d = minimal(); d.dev.roles.worker.handoffTo = ['ghost'];
    expectIssue(d, 'rooms.dev.roles.worker.handoffTo.0: unknown role "ghost"');
    const e = minimal(); e.dev.roles.worker.handoffTo = ['worker'];
    expectIssue(e, 'rooms.dev.roles.worker.handoffTo.0: role must not hand off to itself');
  });

  it('validates members', () => {
    const a = minimal(); a.dev.members[0].role = 'x';
    expectIssue(a, 'rooms.dev.members.0.role: unknown role "x"');
    expectIssue(minimal(), 'rooms.dev.members.0.agent: unknown agent "a1"', { agentNames: ['zz'] });
    const b = minimal(); b.dev.members.push({ agent: 'a1', role: 'worker', botEndpoint: bot('b2') });
    expectIssue(b, 'rooms.dev.members.1.agent: duplicate agent');
    const c = minimal(); c.dev.members.push({ agent: 'a2', role: 'worker', botEndpoint: bot('b1') });
    expectIssue(c, 'rooms.dev.members.1.botEndpoint: bot endpoint "qq:b1" already used');
    const d = full(); d.dev.members[1].aliases = ['boss'];
    expectIssue(d, 'rooms.dev.members.1.aliases.0');
    const d2 = full(); d2.dev.members[1].aliases = ['Boss'];
    expectIssue(d2, 'rooms.dev.members.1.aliases.0: invalid alias');
    const e = full(); e.dev.members[1].aliases = ['lead'];
    expectIssue(e, 'rooms.dev.members.1.aliases.0: alias "lead" conflicts');
    const f = minimal(); f.dev.members[0].aliases = ['Bad Alias'];
    expectIssue(f, 'rooms.dev.members.0.aliases.0: invalid alias');
    const g = minimal();
    g.dev.members = Array.from({ length: ROOM_MAX_MEMBERS + 1 }, (_, i) => ({ agent: `a${i}`, role: 'worker', botEndpoint: bot(`b${i}`) }));
    expectIssue(g, 'at most');
    const h = minimal(); delete h.dev.members[0].botEndpoint;
    expectIssue(h, 'rooms.dev.members.0.botEndpoint: required');
    expectIssue(minimal(), 'unknown endpoint "qq:b1"', { endpointKeys: new Set(['qq:main']) });
  });

  it('rejects alias colliding case-insensitively with an agent name', () => {
    const a = minimal();
    a.dev.members.push({ agent: 'Lead', role: 'worker', botEndpoint: bot('b2') });
    a.dev.members[0].aliases = ['lead'];
    expectIssue(a, 'rooms.dev.members.0.aliases.0: alias "lead" conflicts');
  });

  it('validates coordinator', () => {
    const a = full(); a.dev.coordinator = 'nobody';
    expectIssue(a, 'rooms.dev.coordinator: "nobody" is not a member');
  });

  it('rejects unknown fields', () => {
    const a = minimal(); a.dev.extra = 1;
    expectIssue(a, 'rooms.dev: unknown field "extra"');
    const b = minimal(); b.dev.roles.worker.tool = ['x'];
    expectIssue(b, 'rooms.dev.roles.worker: unknown field "tool"');
    const c = minimal(); c.dev.members[0].x = 1;
    expectIssue(c, 'rooms.dev.members.0: unknown field "x"');
    const d = minimal(); d.dev.conversation.repository = 'r';
    expectIssue(d, 'rooms.dev.conversation: unknown field "repository"');
  });

  it('cross-room conversation conflicts only among enabled rooms', () => {
    const two = { one: minimal().dev, two: minimal().dev };
    expectIssue(two, 'rooms.two.conversation: conversation "qq:group:100" already owned by room "one"');
    (two.two as any).enabled = false;
    expect(() => validateRoomDefinitions(two)).not.toThrow();
  });

  it('aggregates multiple issues', () => {
    const a = minimal(); a.dev.name = ''; a.dev.members[0].role = 'x'; a.dev.extra = 1;
    expect(issuesOf(a).length).toBeGreaterThan(1);
  });
});

describe('exports and isolation', () => {
  it('coexists with legacy exports', async () => {
    const mod: any = await import('../../src/index.js');
    expect(typeof mod.validateRoomDefinitions).toBe('function');
    expect(mod.RoomDefinitionError).toBe(RoomDefinitionError);
    expect(typeof mod.validateWorkroomDefinitions).toBe('function');
  });

  it('room sources import only sibling files', () => {
    const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../src/room');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src).not.toMatch(/@zhin\.js\//);
      expect(src).not.toMatch(/\.\.\/(workroom|workroom-runtime|portfolio|data-governance)\b/);
    }
  });
});
