import {
  ROOM_ALIAS_PATTERN,
  ROOM_CONVERSATION_KINDS,
  ROOM_ID_PATTERN,
  ROOM_MAX_MEMBERS,
  ROOM_RESERVED_NAMES,
  ROOM_ROLE_NAME_PATTERN,
  type RoomDefinition,
} from './room-definition.js';

export class RoomDefinitionError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid room definitions:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'RoomDefinitionError';
    this.issues = Object.freeze([...issues]);
  }
}

export interface RoomValidationContext {
  agentNames?: readonly string[];
  /** Known `adapter:endpoint` keys. */
  endpointKeys?: ReadonlySet<string>;
}

const ROOM_FIELDS = ['name', 'description', 'enabled', 'conversation', 'roles', 'members', 'coordinator'];
const CONVERSATION_FIELDS = ['adapter', 'endpoint', 'kind', 'id'];
const ROLE_FIELDS = ['description', 'prompt', 'tools', 'accepts', 'handoffTo'];
const MEMBER_FIELDS = ['agent', 'role', 'botEndpoint', 'aliases'];
const BOT_FIELDS = ['adapter', 'endpoint'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isCleanString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v === v.trim();
}

function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function checkUnknown(obj: Record<string, unknown>, allowed: readonly string[], path: string, issues: string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) issues.push(`${path}: unknown field "${key}"`);
  }
}

function checkCleanString(obj: Record<string, unknown>, key: string, path: string, issues: string[]): string | undefined {
  const v = own(obj, key);
  if (!isCleanString(v)) {
    issues.push(`${path}.${key}: must be a non-empty string without surrounding whitespace`);
    return undefined;
  }
  return v;
}

function checkStringList(obj: Record<string, unknown>, key: string, path: string, issues: string[]): string[] | undefined {
  const v = own(obj, key);
  if (v === undefined) return undefined;
  const p = `${path}.${key}`;
  if (!Array.isArray(v)) {
    issues.push(`${p}: must be an array of strings`);
    return undefined;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  v.forEach((item, i) => {
    if (!isCleanString(item)) {
      issues.push(`${p}.${i}: must be a non-empty string without surrounding whitespace`);
      return;
    }
    if (seen.has(item)) issues.push(`${p}.${i}: duplicate "${item}"`);
    seen.add(item);
    out.push(item);
  });
  return out;
}

/** Single source of truth for all rules. Pure; never throws. */
export function collectRoomDefinitionIssues(raw: unknown, ctx: RoomValidationContext = {}): string[] {
  const issues: string[] = [];
  if (raw === undefined || raw === null) return issues;
  if (!isPlainObject(raw)) {
    issues.push('rooms: must be an object keyed by room id');
    return issues;
  }
  const agentNames = ctx.agentNames ? new Set(ctx.agentNames) : undefined;
  const conversationOwners = new Map<string, string>();

  for (const [roomId, room] of Object.entries(raw)) {
    const rp = `rooms.${roomId}`;
    if (ROOM_RESERVED_NAMES.includes(roomId) || !ROOM_ID_PATTERN.test(roomId)) {
      issues.push(`${rp}: invalid room id "${roomId}"`);
    }
    if (!isPlainObject(room)) {
      issues.push(`${rp}: must be an object`);
      continue;
    }
    checkUnknown(room, ROOM_FIELDS, rp, issues);

    const name = own(room, 'name');
    if (typeof name !== 'string' || name.trim() === '') issues.push(`${rp}.name: must be a non-empty string`);
    const description = own(room, 'description');
    if (description !== undefined && typeof description !== 'string') issues.push(`${rp}.description: must be a string`);
    const enabledRaw = own(room, 'enabled');
    if (enabledRaw !== undefined && typeof enabledRaw !== 'boolean') issues.push(`${rp}.enabled: must be a boolean`);
    const enabled = enabledRaw !== false;

    // conversation
    let conversationKey: string | undefined;
    const conv = own(room, 'conversation');
    if (!isPlainObject(conv)) {
      issues.push(`${rp}.conversation: required object`);
    } else {
      const cp = `${rp}.conversation`;
      checkUnknown(conv, CONVERSATION_FIELDS, cp, issues);
      const adapter = checkCleanString(conv, 'adapter', cp, issues);
      const endpoint = checkCleanString(conv, 'endpoint', cp, issues);
      const id = checkCleanString(conv, 'id', cp, issues);
      const kind = own(conv, 'kind');
      const kindOk = typeof kind === 'string' && (ROOM_CONVERSATION_KINDS as readonly string[]).includes(kind);
      if (!kindOk) issues.push(`${cp}.kind: must be one of ${ROOM_CONVERSATION_KINDS.join(', ')}`);
      if (adapter && endpoint && ctx.endpointKeys && !ctx.endpointKeys.has(`${adapter}:${endpoint}`)) {
        issues.push(`${cp}.endpoint: unknown endpoint "${adapter}:${endpoint}"`);
      }
      if (adapter && endpoint && id && kindOk) conversationKey = `${adapter}:${endpoint}:${kind}:${id}`;
    }
    if (enabled && conversationKey) {
      const prev = conversationOwners.get(conversationKey);
      if (prev !== undefined) {
        issues.push(`${rp}.conversation: conversation "${conversationKey}" already owned by room "${prev}"`);
      } else {
        conversationOwners.set(conversationKey, roomId);
      }
    }

    // roles
    const roleNames = new Set<string>();
    const rolesRaw = own(room, 'roles');
    const roleEntries: [string, unknown][] = [];
    if (!isPlainObject(rolesRaw)) {
      issues.push(`${rp}.roles: required object with at least one role`);
    } else {
      const entries = Object.entries(rolesRaw);
      if (entries.length === 0) issues.push(`${rp}.roles: must define at least one role`);
      for (const [roleName, role] of entries) {
        const rlp = `${rp}.roles.${roleName}`;
        if (ROOM_RESERVED_NAMES.includes(roleName) || !ROOM_ROLE_NAME_PATTERN.test(roleName)) {
          issues.push(`${rlp}: invalid role name "${roleName}"`);
        } else {
          roleNames.add(roleName);
        }
        roleEntries.push([roleName, role]);
      }
    }
    for (const [roleName, role] of roleEntries) {
      const rlp = `${rp}.roles.${roleName}`;
      if (!isPlainObject(role)) {
        issues.push(`${rlp}: must be an object`);
        continue;
      }
      checkUnknown(role, ROLE_FIELDS, rlp, issues);
      const prompt = own(role, 'prompt');
      if (typeof prompt !== 'string' || prompt.trim() === '') issues.push(`${rlp}.prompt: must be a non-empty string`);
      const rd = own(role, 'description');
      if (rd !== undefined && typeof rd !== 'string') issues.push(`${rlp}.description: must be a string`);
      checkStringList(role, 'tools', rlp, issues);
      checkStringList(role, 'accepts', rlp, issues);
      const handoff = checkStringList(role, 'handoffTo', rlp, issues);
      handoff?.forEach((target, i) => {
        if (target === roleName) issues.push(`${rlp}.handoffTo.${i}: role must not hand off to itself`);
        else if (!roleNames.has(target)) issues.push(`${rlp}.handoffTo.${i}: unknown role "${target}"`);
      });
    }

    // members
    const memberAgents = new Set<string>();
    const membersRaw = own(room, 'members');
    if (!Array.isArray(membersRaw)) {
      issues.push(`${rp}.members: required array`);
    } else {
      if (membersRaw.length === 0) issues.push(`${rp}.members: must contain at least one member`);
      if (membersRaw.length > ROOM_MAX_MEMBERS) {
        issues.push(`${rp}.members: at most ${ROOM_MAX_MEMBERS} members allowed`);
      }
      const botKeys = new Map<string, number>();
      const names = new Map<string, string>();
      // agent names take part in alias uniqueness; register them first
      membersRaw.forEach((member, i) => {
        if (isPlainObject(member)) {
          const agent = own(member, 'agent');
          if (isCleanString(agent) && !names.has(agent.toLowerCase())) names.set(agent.toLowerCase(), `members.${i}.agent`);
        }
      });
      membersRaw.forEach((member, i) => {
        const mp = `${rp}.members.${i}`;
        if (!isPlainObject(member)) {
          issues.push(`${mp}: must be an object`);
          return;
        }
        checkUnknown(member, MEMBER_FIELDS, mp, issues);
        const agent = checkCleanString(member, 'agent', mp, issues);
        if (agent) {
          if (agentNames && !agentNames.has(agent)) issues.push(`${mp}.agent: unknown agent "${agent}"`);
          if (memberAgents.has(agent)) issues.push(`${mp}.agent: duplicate agent "${agent}"`);
          memberAgents.add(agent);
        }
        const role = checkCleanString(member, 'role', mp, issues);
        if (role && !roleNames.has(role)) issues.push(`${mp}.role: unknown role "${role}"`);

        const bot = own(member, 'botEndpoint');
        if (!isPlainObject(bot)) {
          issues.push(`${mp}.botEndpoint: required object`);
        } else {
          const bp = `${mp}.botEndpoint`;
          checkUnknown(bot, BOT_FIELDS, bp, issues);
          const adapter = checkCleanString(bot, 'adapter', bp, issues);
          const endpoint = checkCleanString(bot, 'endpoint', bp, issues);
          if (adapter && endpoint) {
            const key = `${adapter}:${endpoint}`;
            if (ctx.endpointKeys && !ctx.endpointKeys.has(key)) {
              issues.push(`${bp}.endpoint: unknown endpoint "${key}"`);
            }
            const prev = botKeys.get(key);
            if (prev !== undefined) issues.push(`${bp}: bot endpoint "${key}" already used by member ${prev}`);
            else botKeys.set(key, i);
          }
        }
        const aliases = own(member, 'aliases');
        if (aliases !== undefined) {
          if (!Array.isArray(aliases)) issues.push(`${mp}.aliases: must be an array of strings`);
          else {
            aliases.forEach((alias, j) => {
              const ap = `${mp}.aliases.${j}`;
              if (typeof alias !== 'string' || !ROOM_ALIAS_PATTERN.test(alias)) {
                issues.push(`${ap}: invalid alias`);
                return;
              }
              const k = alias.toLowerCase();
              const prev = names.get(k);
              if (prev !== undefined) issues.push(`${ap}: alias "${alias}" conflicts with ${prev}`);
              else names.set(k, `members.${i}.aliases.${j}`);
            });
          }
        }
      });
    }

    // coordinator
    const coordinator = own(room, 'coordinator');
    if (coordinator !== undefined) {
      if (!isCleanString(coordinator)) issues.push(`${rp}.coordinator: must be a non-empty string`);
      else if (!memberAgents.has(coordinator)) issues.push(`${rp}.coordinator: "${coordinator}" is not a member`);
    }
  }
  return issues;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

function cloneValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(cloneValue);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = cloneValue(val);
    return out;
  }
  return v;
}

/** Validate (fail-closed) and return a deep-frozen copy; input is never modified. */
export function validateRoomDefinitions(
  raw: unknown,
  ctx: RoomValidationContext = {},
): Readonly<Record<string, RoomDefinition>> {
  const issues = collectRoomDefinitionIssues(raw, ctx);
  if (issues.length > 0) throw new RoomDefinitionError(issues);
  const out: Record<string, RoomDefinition> = Object.create(null);
  if (raw === undefined || raw === null) return deepFreeze(out);
  for (const [id, room] of Object.entries(raw as Record<string, unknown>)) {
    const copy = cloneValue(room) as RoomDefinition;
    const roles: Record<string, RoomDefinition['roles'][string]> = Object.create(null);
    for (const [rn, rv] of Object.entries(copy.roles)) roles[rn] = rv;
    out[id] = { ...copy, name: copy.name.trim(), roles };
  }
  return deepFreeze(out);
}
