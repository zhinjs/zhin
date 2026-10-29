/**
 * Adapter capability profile (ADR 0044 C1): the spec layer.
 *
 * The profile is the Adapter's *declaration* of what its platform can do, per conversation kind and in
 * seven groups. Resolution (`resolveTurnCapabilities`) merges the sections that apply to one
 * conversation and then only ever *narrows* it (adapter `resolveCapabilities` patch + generic facts such
 * as the Bot's platform role or mute state). Capabilities describe what the platform allows; product
 * authorization (roles, hard gates, approvals) still intersects with them elsewhere.
 *
 * Everything here is pure data + pure functions; it imports no platform name.
 * @module @zhin.js/adapter
 */
import { getLogger } from '@zhin.js/logger';
import type { ConversationRef } from '@zhin.js/im-contract';
import type {
  AdapterCapability,
  AdapterOperation,
  AdapterSegmentPolicy,
} from './definition.js';

const logger = getLogger('adapter.capability');

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** Platform-neutral role ladder used by `requiresRole`. */
export type ProfileRole = 'owner' | 'admin' | 'member';
export const PROFILE_ROLES: readonly ProfileRole[] = ['member', 'admin', 'owner'];

/** A conversation kind a section or action scope refers to: the built-in four or an adapter-declared one. */
export type ProfileScope = 'private' | 'group' | 'channel' | 'thread' | (string & {});

export interface NumberRange {
  readonly min?: number;
  readonly max?: number;
}

/** Standard event names an adapter may declare in `events.emit` (open set: other dotted names are allowed). */
export type StandardEventName =
  | 'member.joined'
  | 'member.left'
  | 'member.role_changed'
  | 'member.muted'
  | 'member.card_changed'
  | 'message.recalled'
  | 'message.reaction'
  | 'poke';

export const ADAPTER_ACTION_NAMES = [
  'reaction', 'poke', 'mute', 'unmute', 'muteAll', 'kick', 'setCard', 'setTitle',
  'recall', 'essence', 'announce', 'invite', 'quoteReply', 'forward',
] as const;
export type AdapterActionName = (typeof ADAPTER_ACTION_NAMES)[number];

type NoParams = Readonly<Record<never, never>>;

/** Typed `params` of every action. */
export interface AdapterActionParams {
  readonly reaction: Readonly<{
    /** Emoji the Bot may react with. */
    emojis?: readonly string[];
    /** May react to the Bot's own messages / to others' messages. */
    own?: boolean;
    others?: boolean;
    /** The reaction can be taken back. */
    cancellable?: boolean;
  }>;
  readonly poke: Readonly<{ self?: boolean; minIntervalSeconds?: number }>;
  readonly mute: Readonly<{ durationSeconds?: NumberRange; targetsHigherRole?: boolean }>;
  readonly unmute: NoParams;
  readonly muteAll: NoParams;
  readonly kick: Readonly<{ block?: boolean }>;
  readonly setCard: Readonly<{ maxLength?: number }>;
  readonly setTitle: Readonly<{ maxLength?: number }>;
  readonly recall: Readonly<{ timeLimitSeconds?: number; others?: boolean }>;
  readonly essence: NoParams;
  readonly announce: Readonly<{ maxLength?: number }>;
  readonly invite: Readonly<{ requiresFriend?: boolean }>;
  readonly quoteReply: NoParams;
  readonly forward: Readonly<{ maxNodes?: number }>;
}

/** One entry of the `actions` table: where it works, who the Bot must be, and its parameter limits. */
export interface AdapterActionDeclaration<TParams = NoParams> {
  /** Conversation kinds the action works in (required: an action is never implicitly everywhere). */
  readonly scopes: readonly ProfileScope[];
  /** Minimum Bot platform role; unknown role fails closed. */
  readonly requiresRole?: ProfileRole;
  readonly params?: TParams;
}

export type AdapterActionsCapabilities = {
  readonly [A in AdapterActionName]?: AdapterActionDeclaration<AdapterActionParams[A]> | false;
};

/** 消息 */
export interface MessagingCapabilities {
  /** Existing segment policy; `AdapterDefinition.segments` is an alias of `default.messaging.segments`. */
  readonly segments?: AdapterSegmentPolicy;
  /** Max characters of one message. */
  readonly maxLength?: number;
  readonly mention?: Readonly<{ user?: boolean; all?: boolean }>;
  /** Quote-reply an earlier message. */
  readonly quote?: boolean;
  /** The platform has message reactions; `emojis` is its vocabulary. */
  readonly reaction?: Readonly<{ emojis?: readonly string[] }> | false;
  readonly recall?: Readonly<{ timeLimitSeconds?: number; others?: boolean }> | false;
  readonly edit?: boolean;
  readonly forward?: Readonly<{ maxNodes?: number }> | false;
  /** Max messages the Bot may send for one turn. */
  readonly maxMessagesPerTurn?: number;
}

/** 会话场景 */
export interface SceneCapabilities {
  /** The group/channel info lookup port is usable. */
  readonly groupInfo?: boolean;
  /** The member profile lookup port is usable. */
  readonly memberProfile?: boolean;
  /** Platform role word -> `owner | admin | member`. Canonical words map to themselves. */
  readonly roles?: Readonly<Record<string, ProfileRole>>;
  /** Mute semantics: allowed duration range and whether the whole conversation can be muted. */
  readonly mute?: Readonly<{ durationSeconds?: NumberRange; all?: boolean }> | false;
  readonly maxMembers?: number;
  /** Members have a card / a special title. */
  readonly card?: boolean;
  readonly title?: boolean;
}

/** 事件 */
export interface EventsCapabilities {
  /** Standard event names this adapter emits. */
  readonly emit?: readonly (StandardEventName | (string & {}))[];
  /** `liveDanmaku` (ADR 0038 §5), the former `capabilities: ['liveDanmaku']`; requires `inbound`. */
  readonly liveDanmaku?: boolean;
}

export type FeedbackMode = 'typing' | 'reaction' | 'status-message' | 'none';

/** 交互反馈 */
export interface FeedbackCapabilities {
  readonly mode?: FeedbackMode;
  /** Emoji for `reaction`, text for `status-message`. */
  readonly emoji?: string;
  readonly text?: string;
  /** Refresh interval for a `typing` indicator. */
  readonly refreshSeconds?: number;
}

/** 投递约束 */
export interface DeliveryCapabilities {
  /** The Bot can send into this conversation at all. */
  readonly send?: boolean;
  /** Sending without a preceding inbound message (not a passive reply) is allowed. */
  readonly proactive?: boolean;
  readonly passiveWindow?: Readonly<{ seconds?: number; maxMessages?: number }> | false;
  readonly rateLimitPerMinute?: number;
  readonly mediaMaxBytes?: number;
  /** Large media must be written to disk before sending. */
  readonly spool?: boolean;
  /** Sending needs the inbound message sequence number. */
  readonly requiresMessageSeq?: boolean;
}

/** prompt 贡献 */
export interface PromptCapabilities {
  /** Generate the platform description from the capabilities (default on). */
  readonly auto?: boolean;
  /** Adapter-authored text appended to the `platform` section. */
  readonly text?: string;
}

/** 运行时 (additive to the seven groups, ADR 0044 C3) */
export interface RuntimeCapabilities {
  /** The Endpoint is the authenticated local sandbox ingress (trusted owner may configure the agent run). */
  readonly sandbox?: boolean;
}

/** What one conversation-kind section declares: the seven groups plus `runtime`. */
export interface CapabilitySection {
  readonly messaging?: MessagingCapabilities;
  readonly scene?: SceneCapabilities;
  readonly actions?: AdapterActionsCapabilities;
  readonly events?: EventsCapabilities;
  readonly feedback?: FeedbackCapabilities;
  readonly delivery?: DeliveryCapabilities;
  readonly prompt?: PromptCapabilities;
  readonly runtime?: RuntimeCapabilities;
}

/**
 * `defineAdapter({ profile })`. Every kind section inherits `default`; a field set in a kind section
 * overrides the same field of `default` (`false` switches an inherited toggle capability off).
 */
export interface AdapterCapabilityProfile {
  readonly default?: CapabilitySection;
  readonly private?: CapabilitySection;
  readonly group?: CapabilitySection;
  readonly channel?: CapabilitySection;
  readonly thread?: CapabilitySection;
  /** Adapter-declared extra kinds, matched by `resolveTurnCapabilities({ extraKinds })`. */
  readonly kinds?: Readonly<Record<string, CapabilitySection>>;
}

/** Narrow-only patch returned by the adapter's `resolveCapabilities`; `false` switches a capability off. */
export type CapabilityPatch = {
  readonly [G in keyof CapabilitySection]?: PatchOf<NonNullable<CapabilitySection[G]>>;
};
type PatchOf<T> = T extends readonly (infer U)[]
  ? readonly U[]
  : T extends object
    ? { readonly [K in keyof T]?: PatchOf<NonNullable<T[K]>> | false }
    : T | false;

/** Trusted facts for dynamic narrowing: structurally a subset of the agent's `TurnContextState`. */
export interface CapabilityFacts {
  readonly bot?: Readonly<{
    platformRole?: string;
    platformRoleError?: string;
    /** Missing/null is unknown; 0 is unmuted; positive is the expiry (epoch ms). */
    mutedUntil?: number | null;
  }>;
  readonly conversation?: Readonly<{ muteAll?: boolean }>;
  readonly sender?: Readonly<{ platformRole?: string }>;
}

/** Delivery state the adapter reports for the current turn (all optional). */
export interface CapabilityDeliveryState {
  /** Seconds left in the passive-reply window; `0` means it has closed. */
  readonly passiveWindowRemainingSeconds?: number;
  /** Messages still allowed in the passive-reply window. */
  readonly passiveMessagesRemaining?: number;
}

export interface ResolveCapabilitiesContext {
  readonly conversation: ConversationRef;
  readonly facts: CapabilityFacts;
  readonly delivery: CapabilityDeliveryState;
  /** The static capabilities for this conversation after generic narrowing; patch against this. */
  readonly capabilities: CapabilitySection;
}

/** Adapter dynamic resolver. Pure, synchronous, runs once per turn. Widening fields are dropped. */
export type AdapterCapabilityResolver = (
  context: ResolveCapabilitiesContext,
) => CapabilityPatch | undefined | void;

// ---------------------------------------------------------------------------------------------
// Action -> port table (the single source for "declared => implemented")
// ---------------------------------------------------------------------------------------------

export type ActionPort =
  | Readonly<{ port: 'control'; method: 'recall' | 'addReaction' }>
  | Readonly<{ port: 'management'; method: string }>
  /** Implemented by the Endpoint's `send()`; needs the `outbound` capability. */
  | Readonly<{ port: 'send' }>;

export const ADAPTER_ACTION_PORTS: Readonly<Record<AdapterActionName, ActionPort>> = Object.freeze({
  reaction: { port: 'control', method: 'addReaction' },
  poke: { port: 'management', method: 'pokeUser' },
  mute: { port: 'management', method: 'muteGroupMember' },
  unmute: { port: 'management', method: 'unmuteGroupMember' },
  muteAll: { port: 'management', method: 'muteAllGroupMembers' },
  kick: { port: 'management', method: 'kickGroupMember' },
  setCard: { port: 'management', method: 'setGroupCard' },
  setTitle: { port: 'management', method: 'setGroupTitle' },
  recall: { port: 'control', method: 'recall' },
  essence: { port: 'management', method: 'setGroupEssence' },
  announce: { port: 'management', method: 'sendGroupNotice' },
  invite: { port: 'management', method: 'inviteGroupMember' },
  quoteReply: { port: 'send' },
  forward: { port: 'send' },
});

// ---------------------------------------------------------------------------------------------
// Schema: one description drives validation, inheritance and narrowing
// ---------------------------------------------------------------------------------------------

type Node =
  | Readonly<{ t: 'flag' }>
  | Readonly<{ t: 'max' }>
  | Readonly<{ t: 'min' }>
  | Readonly<{ t: 'set'; nonEmpty?: boolean }>
  | Readonly<{ t: 'range' }>
  | Readonly<{ t: 'role' }>
  | Readonly<{ t: 'enum'; values: readonly string[]; off?: string }>
  | Readonly<{ t: 'text' }>
  | Readonly<{ t: 'fixed'; check: (value: unknown) => unknown }>
  | Readonly<{ t: 'obj'; fields: Readonly<Record<string, Node>>; toggle?: boolean; required?: readonly string[] }>;

const FLAG: Node = { t: 'flag' };
const MAX: Node = { t: 'max' };
const MIN: Node = { t: 'min' };
const RANGE: Node = { t: 'range' };
const SET: Node = { t: 'set' };
const obj = (fields: Record<string, Node>, extra: { toggle?: boolean; required?: readonly string[] } = {}): Node =>
  ({ t: 'obj', fields, ...extra });

const ACTION_PARAM_NODES: Readonly<Record<AdapterActionName, Record<string, Node>>> = {
  reaction: { emojis: { t: 'set', nonEmpty: true }, own: FLAG, others: FLAG, cancellable: FLAG },
  poke: { self: FLAG, minIntervalSeconds: MIN },
  mute: { durationSeconds: RANGE, targetsHigherRole: FLAG },
  unmute: {},
  muteAll: {},
  kick: { block: FLAG },
  setCard: { maxLength: MAX },
  setTitle: { maxLength: MAX },
  recall: { timeLimitSeconds: MAX, others: FLAG },
  essence: {},
  announce: { maxLength: MAX },
  invite: { requiresFriend: FLAG },
  quoteReply: {},
  forward: { maxNodes: MAX },
};

const actionNode = (name: AdapterActionName): Node => obj({
  scopes: { t: 'set', nonEmpty: true },
  requiresRole: { t: 'role' },
  params: obj(ACTION_PARAM_NODES[name]),
}, { toggle: true, required: ['scopes'] });

const EVENT_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/u;
const SCOPE_NAME = /^[a-z][a-zA-Z0-9_-]*$/u;

const SECTION_NODE: Node = obj({
  messaging: obj({
    segments: { t: 'fixed', check: (value) => validateSegments(value) },
    maxLength: MAX,
    mention: obj({ user: FLAG, all: FLAG }),
    quote: FLAG,
    reaction: obj({ emojis: SET }, { toggle: true }),
    recall: obj({ timeLimitSeconds: MAX, others: FLAG }, { toggle: true }),
    edit: FLAG,
    forward: obj({ maxNodes: MAX }, { toggle: true }),
    maxMessagesPerTurn: MAX,
  }),
  scene: obj({
    groupInfo: FLAG,
    memberProfile: FLAG,
    roles: { t: 'fixed', check: validateRoleMap },
    mute: obj({ durationSeconds: RANGE, all: FLAG }, { toggle: true }),
    maxMembers: MAX,
    card: FLAG,
    title: FLAG,
  }),
  actions: obj(Object.fromEntries(ADAPTER_ACTION_NAMES.map((name) => [name, actionNode(name)]))),
  events: obj({
    emit: { t: 'set', nonEmpty: false },
    liveDanmaku: FLAG,
  }),
  feedback: obj({
    mode: { t: 'enum', values: ['typing', 'reaction', 'status-message', 'none'], off: 'none' },
    emoji: { t: 'text' },
    text: { t: 'text' },
    refreshSeconds: MAX,
  }),
  delivery: obj({
    send: FLAG,
    proactive: FLAG,
    passiveWindow: obj({ seconds: MAX, maxMessages: MAX }, { toggle: true }),
    rateLimitPerMinute: MAX,
    mediaMaxBytes: MAX,
    spool: FLAG,
    requiresMessageSeq: FLAG,
  }),
  prompt: obj({ auto: FLAG, text: { t: 'text' } }),
  runtime: obj({ sandbox: FLAG }),
});

const PROFILE_KINDS = ['default', 'private', 'group', 'channel', 'thread'] as const;

// -- validation --------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new TypeError(`Adapter profile ${path}: ${message}`);
}

function validateSegments(value: unknown): unknown {
  // Full shape validation is delegated to the segment policy normalizer (see normalizeCapabilityProfile).
  if (!isRecord(value)) fail('messaging.segments', 'must be an object');
  return value;
}

function validateRoleMap(value: unknown): unknown {
  if (!isRecord(value)) fail('scene.roles', 'must map platform role words to owner | admin | member');
  for (const [word, role] of Object.entries(value)) {
    if (!word || !PROFILE_ROLES.includes(role as ProfileRole)) {
      fail(`scene.roles.${word}`, 'must be owner, admin or member');
    }
  }
  return Object.freeze({ ...value });
}

function validateNode(node: Node, value: unknown, path: string): unknown {
  switch (node.t) {
    case 'flag':
      if (typeof value !== 'boolean') fail(path, 'must be a boolean');
      return value;
    case 'max':
    case 'min':
      if (typeof value !== 'number' || !Number.isFinite(value)
        || (node.t === 'max' ? value <= 0 : value < 0)) {
        fail(path, node.t === 'max' ? 'must be a positive number' : 'must be a non-negative number');
      }
      return value;
    case 'set': {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
        fail(path, 'must be an array of non-empty strings');
      }
      const items = [...new Set(value as string[])];
      if (node.nonEmpty && items.length === 0) fail(path, 'must not be empty');
      if (path.endsWith('.scopes') && items.some((item) => !SCOPE_NAME.test(item))) {
        fail(path, 'must contain conversation kind names such as private, group, channel, thread');
      }
      if (path.endsWith('events.emit') && items.some((item) => !EVENT_NAME.test(item))) {
        fail(path, 'must contain dotted standard event names such as member.joined');
      }
      return Object.freeze(items);
    }
    case 'range': {
      if (!isRecord(value)) fail(path, 'must be { min?, max? }');
      const { min, max, ...rest } = value;
      if (Object.keys(rest).length > 0) fail(path, `unknown field ${Object.keys(rest)[0]}`);
      for (const [key, bound] of [['min', min], ['max', max]] as const) {
        if (bound !== undefined && (typeof bound !== 'number' || !Number.isFinite(bound) || bound < 0)) {
          fail(`${path}.${key}`, 'must be a non-negative number');
        }
      }
      if (min === undefined && max === undefined) fail(path, 'needs min and/or max');
      if (min !== undefined && max !== undefined && (min as number) > (max as number)) {
        fail(path, 'min must not exceed max');
      }
      return Object.freeze({
        ...(min !== undefined ? { min: min as number } : {}),
        ...(max !== undefined ? { max: max as number } : {}),
      });
    }
    case 'role':
      if (!PROFILE_ROLES.includes(value as ProfileRole)) fail(path, 'must be owner, admin or member');
      return value;
    case 'enum':
      if (typeof value !== 'string' || !node.values.includes(value)) {
        fail(path, `must be one of ${node.values.join(' | ')}`);
      }
      return value;
    case 'text':
      if (typeof value !== 'string' || !value.trim()) fail(path, 'must be a non-empty string');
      return value;
    case 'fixed':
      return node.check(value);
    case 'obj': {
      if (value === false && node.toggle) return false;
      if (!isRecord(value)) fail(path, node.toggle ? 'must be an object or false' : 'must be an object');
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const child = node.fields[key];
        if (!child) fail(path ? `${path}.${key}` : key, 'unknown field');
        if (item === undefined) continue;
        result[key] = validateNode(child, item, path ? `${path}.${key}` : key);
      }
      for (const key of node.required ?? []) {
        if (result[key] === undefined) fail(`${path}.${key}`, 'is required');
      }
      return Object.freeze(result);
    }
  }
}

/**
 * Validate a static profile. Unknown fields, wrong types and unknown sections throw (fail closed).
 * Returns a deeply frozen, de-duplicated copy. `messaging.segments` is validated by the caller's
 * segment normalizer through `normalizeSegments`.
 */
export function normalizeCapabilityProfile(
  profile: AdapterCapabilityProfile,
  normalizeSegments: (policy: AdapterSegmentPolicy) => AdapterSegmentPolicy | undefined = (policy) => policy,
): AdapterCapabilityProfile {
  if (!isRecord(profile)) throw new TypeError('Adapter profile must be an object');
  const result: Record<string, unknown> = {};
  for (const [key, section] of Object.entries(profile)) {
    if (key === 'kinds') {
      if (!isRecord(section)) fail('kinds', 'must map kind names to sections');
      result.kinds = Object.freeze(Object.fromEntries(Object.entries(section).map(([name, body]) => {
        if (!SCOPE_NAME.test(name) || (PROFILE_KINDS as readonly string[]).includes(name)) {
          fail(`kinds.${name}`, 'must be a new kind name (not default/private/group/channel/thread)');
        }
        return [name, validateSection(body, `kinds.${name}`, normalizeSegments)];
      })));
    } else if ((PROFILE_KINDS as readonly string[]).includes(key)) {
      if (section !== undefined) result[key] = validateSection(section, key, normalizeSegments);
    } else {
      fail(key, 'unknown section (use default | private | group | channel | thread | kinds)');
    }
  }
  return Object.freeze(result) as AdapterCapabilityProfile;
}

function validateSection(
  section: unknown,
  path: string,
  normalizeSegments: (policy: AdapterSegmentPolicy) => AdapterSegmentPolicy | undefined,
): CapabilitySection {
  const validated = { ...(validateNode(SECTION_NODE, section, path) as Record<string, unknown>) };
  const messaging = validated.messaging as Record<string, unknown> | undefined;
  if (messaging?.segments) {
    const segments = normalizeSegments(messaging.segments as AdapterSegmentPolicy);
    validated.messaging = Object.freeze({ ...messaging, ...(segments ? { segments } : {}) });
  }
  return Object.freeze(validated) as CapabilitySection;
}

// ---------------------------------------------------------------------------------------------
// Static resolution: inheritance (default -> kinds) with override semantics
// ---------------------------------------------------------------------------------------------

function overrideMerge(node: Node, base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (node.t === 'obj' && isRecord(over) && isRecord(base)) {
    const result: Record<string, unknown> = { ...base };
    for (const [key, item] of Object.entries(over)) {
      const child = node.fields[key];
      result[key] = child ? overrideMerge(child, base[key], item) : item;
    }
    return result;
  }
  return over;
}

/** Drop `false` toggles and actions whose `scopes` exclude every active kind. */
function prune(node: Node, value: unknown, activeKinds?: readonly string[]): unknown {
  if (node.t !== 'obj') return value;
  if (value === false) return undefined;
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const child = node.fields[key];
    if (!child) continue;
    const pruned = prune(child, item, activeKinds);
    if (pruned === undefined) continue;
    if (isRecord(pruned) && (child as { required?: readonly string[] }).required?.includes('scopes')) {
      const scopes = pruned.scopes as readonly string[] | undefined;
      if (!scopes || scopes.length === 0) continue;
      if (activeKinds && !scopes.some((scope) => activeKinds.includes(scope))) continue;
      const emojis = (pruned.params as { emojis?: readonly string[] } | undefined)?.emojis;
      if (Array.isArray(emojis) && emojis.length === 0) continue;
    }
    result[key] = pruned;
  }
  return Object.freeze(result);
}

/** The conversation's active section names, in application order after `default`. */
export function activeCapabilityKinds(
  conversation: Pick<ConversationRef, 'kind' | 'threadId'>,
  extraKinds: readonly string[] = [],
): readonly string[] {
  return Object.freeze([
    conversation.kind,
    ...(conversation.threadId ? ['thread'] : []),
    ...extraKinds,
  ]);
}

/** Merge `default` with the active kind sections (later wins per field) and prune. */
export function resolveStaticCapabilities(
  profile: AdapterCapabilityProfile,
  activeKinds: readonly string[],
): CapabilitySection {
  let merged: unknown = profile.default;
  for (const kind of activeKinds) {
    const section = (PROFILE_KINDS as readonly string[]).includes(kind)
      ? (profile as Record<string, CapabilitySection | undefined>)[kind]
      : profile.kinds?.[kind];
    merged = overrideMerge(SECTION_NODE, merged, section);
  }
  return (prune(SECTION_NODE, merged ?? {}, activeKinds) ?? Object.freeze({})) as CapabilitySection;
}

// ---------------------------------------------------------------------------------------------
// Narrow-only application
// ---------------------------------------------------------------------------------------------

const roleRank = (role: unknown): number => PROFILE_ROLES.indexOf(role as ProfileRole);

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface NarrowReport {
  readonly warnings: string[];
}

function widen(report: NarrowReport, path: string, why: string): undefined {
  report.warnings.push(`${path}: ${why}`);
  return undefined;
}

/**
 * Apply `patch` to `base`, keeping only changes that remove a capability or shrink a limit.
 * Returns the new value (`undefined` = the capability is off) or `KEEP` when nothing changes.
 */
const KEEP = Symbol('keep');

function narrow(node: Node, base: unknown, patch: unknown, path: string, report: NarrowReport): unknown {
  if (patch === undefined) return KEEP;
  switch (node.t) {
    case 'flag':
      if (patch === false) return base === true ? false : KEEP;
      if (patch === true && base === true) return KEEP;
      widen(report, path, 'cannot enable a capability, only narrow');
      return KEEP;
    case 'max':
      if (typeof patch !== 'number' || !(patch > 0)) { widen(report, path, 'must be a positive number'); return KEEP; }
      if (typeof base === 'number' && patch > base) { widen(report, path, `cannot raise ${base} to ${patch}`); return KEEP; }
      return patch === base ? KEEP : patch;
    case 'min':
      if (typeof patch !== 'number' || patch < 0) { widen(report, path, 'must be a non-negative number'); return KEEP; }
      if (typeof base === 'number' && patch < base) { widen(report, path, `cannot lower ${base} to ${patch}`); return KEEP; }
      return patch === base ? KEEP : patch;
    case 'set': {
      if (!Array.isArray(patch)) { widen(report, path, 'must be an array'); return KEEP; }
      if (!Array.isArray(base)) return Object.freeze([...new Set(patch as string[])]);
      const kept = (patch as string[]).filter((item) => base.includes(item));
      if (kept.length !== new Set(patch as string[]).size) widen(report, path, 'dropped values not in the static profile');
      const unique = [...new Set(kept)];
      return unique.length === base.length ? KEEP : Object.freeze(unique);
    }
    case 'range': {
      if (!isRecord(patch)) { widen(report, path, 'must be { min?, max? }'); return KEEP; }
      const baseRange = isRecord(base) ? base : {};
      let min = baseRange.min as number | undefined;
      let max = baseRange.max as number | undefined;
      if (typeof patch.min === 'number') {
        if (min !== undefined && patch.min < min) widen(report, `${path}.min`, `cannot lower ${min} to ${patch.min}`);
        else min = patch.min;
      }
      if (typeof patch.max === 'number') {
        if (max !== undefined && patch.max > max) widen(report, `${path}.max`, `cannot raise ${max} to ${patch.max}`);
        else max = patch.max;
      }
      if (min !== undefined && max !== undefined && min > max) return undefined; // empty range: off
      const next = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
      return sameJson(next, base) ? KEEP : Object.freeze(next);
    }
    case 'role':
      if (roleRank(patch) < 0) { widen(report, path, 'must be owner, admin or member'); return KEEP; }
      if (base !== undefined && roleRank(patch) < roleRank(base)) {
        widen(report, path, `cannot lower required role ${String(base)} to ${String(patch)}`);
        return KEEP;
      }
      return patch === base ? KEEP : patch;
    case 'enum':
      if (patch === base) return KEEP;
      if (node.off !== undefined && patch === node.off) return patch;
      widen(report, path, `can only be switched to ${node.off ?? 'its current value'}`);
      return KEEP;
    case 'text':
    case 'fixed':
      if (!sameJson(patch, base)) widen(report, path, 'is not narrowable');
      return KEEP;
    case 'obj': {
      if (patch === false) {
        if (node.toggle) return base === undefined ? KEEP : undefined;
        widen(report, path, 'group cannot be switched off as a whole');
        return KEEP;
      }
      if (!isRecord(patch)) { widen(report, path, 'must be an object'); return KEEP; }
      if (node.toggle && base === undefined) {
        widen(report, path, 'cannot enable a capability, only narrow');
        return KEEP;
      }
      const baseObj = isRecord(base) ? base : {};
      const result: Record<string, unknown> = { ...baseObj };
      let changed = false;
      for (const [key, item] of Object.entries(patch)) {
        const child = node.fields[key];
        const childPath = path ? `${path}.${key}` : key;
        if (!child) { widen(report, childPath, 'unknown field'); continue; }
        const outcome = narrow(child, baseObj[key], item, childPath, report);
        if (outcome === KEEP) continue;
        changed = true;
        if (outcome === undefined) delete result[key]; else result[key] = outcome;
      }
      return changed ? Object.freeze(result) : KEEP;
    }
  }
}

/** Apply a narrow-only patch to a resolved section. Widening fields are dropped and reported. */
export function narrowCapabilities(
  base: CapabilitySection,
  patch: CapabilityPatch | undefined,
  report: { warnings: string[] } = { warnings: [] },
): CapabilitySection {
  if (!patch) return base;
  if (!isRecord(patch)) { widen(report, '(patch)', 'must be an object'); return base; }
  const outcome = narrow(SECTION_NODE, base, patch, '', report);
  if (outcome === KEEP || !isRecord(outcome)) return base;
  const pruned = prune(SECTION_NODE, outcome) as Record<string, unknown>;
  return Object.freeze(pruned) as CapabilitySection;
}

// ---------------------------------------------------------------------------------------------
// Turn resolution
// ---------------------------------------------------------------------------------------------

const MESSAGE_SENDING_ACTIONS: readonly AdapterActionName[] = ['quoteReply', 'forward', 'announce'];

/** Map a platform role word to the owner/admin/member ladder; `undefined` = unknown. */
export function resolvePlatformRole(
  scene: SceneCapabilities | undefined,
  word: string | undefined,
): ProfileRole | undefined {
  if (!word) return undefined;
  const mapped = scene?.roles?.[word];
  if (mapped) return mapped;
  return PROFILE_ROLES.includes(word as ProfileRole) ? word as ProfileRole : undefined;
}

function isBotMuted(
  capabilities: CapabilitySection,
  facts: CapabilityFacts,
  now: number,
): boolean {
  const until = facts.bot?.mutedUntil;
  if (typeof until === 'number' && until > now) return true;
  if (facts.conversation?.muteAll === true) {
    const role = resolvePlatformRole(capabilities.scene, facts.bot?.platformRole);
    return role !== 'owner' && role !== 'admin';
  }
  return false;
}

/** Generic narrowing that needs no adapter code: role gating, mute, passive window. */
function genericPatch(
  capabilities: CapabilitySection,
  facts: CapabilityFacts,
  delivery: CapabilityDeliveryState,
  now: number,
): Record<string, unknown> {
  const actions: Record<string, false> = {};
  const botRole = resolvePlatformRole(capabilities.scene, facts.bot?.platformRole);
  for (const name of ADAPTER_ACTION_NAMES) {
    const declaration = capabilities.actions?.[name];
    if (!declaration) continue;
    const required = declaration.requiresRole;
    // Unknown role fails closed: the action stays off rather than being offered and refused.
    if (required && (botRole === undefined || roleRank(botRole) < roleRank(required))) actions[name] = false;
  }
  const deliveryPatch: Record<string, unknown> = {};
  if (isBotMuted(capabilities, facts, now)) {
    deliveryPatch.send = false;
    deliveryPatch.proactive = false;
    for (const name of MESSAGE_SENDING_ACTIONS) if (capabilities.actions?.[name]) actions[name] = false;
  }
  const window = capabilities.delivery?.passiveWindow;
  const seconds = delivery.passiveWindowRemainingSeconds;
  const messages = delivery.passiveMessagesRemaining;
  if (window && (seconds !== undefined || messages !== undefined)) {
    const windowPatch: Record<string, number> = {};
    if (seconds !== undefined && seconds > 0) windowPatch.seconds = seconds;
    if (messages !== undefined && messages > 0) windowPatch.maxMessages = messages;
    if (Object.keys(windowPatch).length > 0) deliveryPatch.passiveWindow = windowPatch;
    const closed = (seconds !== undefined && seconds <= 0) || (messages !== undefined && messages <= 0);
    // Outside the passive window only a proactive-capable platform may still send.
    if (closed && capabilities.delivery?.proactive !== true) deliveryPatch.send = false;
  }
  return {
    ...(Object.keys(actions).length > 0 ? { actions } : {}),
    ...(Object.keys(deliveryPatch).length > 0 ? { delivery: deliveryPatch } : {}),
  };
}

export interface ResolveTurnCapabilitiesInput {
  readonly profile: AdapterCapabilityProfile;
  readonly conversation: ConversationRef;
  readonly facts?: CapabilityFacts;
  readonly delivery?: CapabilityDeliveryState;
  /** The adapter's `resolveCapabilities`. */
  readonly narrow?: AdapterCapabilityResolver;
  /** Adapter-declared extra kind sections to apply (after the built-in kinds). */
  readonly extraKinds?: readonly string[];
  /** Clock for `mutedUntil`; injectable for tests. */
  readonly now?: number;
}

const warnedOnce = new Set<string>();
function logWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) {
    if (warnedOnce.has(warning) || warnedOnce.size > 256) continue;
    warnedOnce.add(warning);
    logger.warn(`adapter resolveCapabilities widening dropped (${warning})`);
  }
}

/**
 * Pure per-turn resolution (ADR 0044 §2): merge `default` with the conversation's kind sections, apply
 * generic narrowing from trusted facts, then the adapter's narrow-only patch.
 */
export function resolveTurnCapabilities(input: ResolveTurnCapabilitiesInput): TurnCapabilities {
  const facts = input.facts ?? {};
  const delivery = input.delivery ?? {};
  const now = input.now ?? Date.now();
  const kinds = activeCapabilityKinds(input.conversation, input.extraKinds);
  const base = resolveStaticCapabilities(input.profile, kinds);
  const report: NarrowReport = { warnings: [] };
  let current = narrowCapabilities(base, genericPatch(base, facts, delivery, now) as CapabilityPatch, report);
  if (input.narrow) {
    let patch: CapabilityPatch | undefined | void;
    try {
      patch = input.narrow({
        conversation: input.conversation, facts, delivery, capabilities: current,
      });
    } catch (error) {
      // A broken resolver must not widen anything; keep the generically narrowed capabilities.
      report.warnings.push(`resolveCapabilities threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    current = narrowCapabilities(current, patch ?? undefined, report);
  }
  logWarnings(report.warnings);
  return new TurnCapabilities({
    kind: input.conversation.kind,
    kinds,
    static: base,
    resolved: current,
    warnings: report.warnings,
  });
}

function leafPaths(value: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      for (const [path, leaf] of leafPaths(item, prefix ? `${prefix}.${key}` : key)) out.set(path, leaf);
    }
    if (Object.keys(value).length === 0 && prefix) out.set(prefix, value);
  } else if (prefix) out.set(prefix, value);
  return out;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => isRecord(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item);
}

/**
 * The capabilities of one turn, computed once and read-only. Paths are dotted: `actions.mute`,
 * `messaging.maxLength`, `delivery.send`. Inside an action, `params` is transparent, so
 * `actions.recall.others` and `actions.mute.durationSeconds` work.
 */
export class TurnCapabilities {
  /** Conversation kind (`private | group | channel`). */
  readonly kind: string;
  /** Section names applied after `default`. */
  readonly kinds: readonly string[];
  /** The fully resolved, frozen capabilities of this turn. */
  readonly resolved: CapabilitySection;
  /** Capabilities before dynamic narrowing (role, mute, window, adapter patch). */
  readonly static: CapabilitySection;
  /** Leaf paths the dynamic layer removed or changed (diagnostic; stable order). */
  readonly narrowed: readonly string[];
  /** Widening attempts that were dropped. */
  readonly warnings: readonly string[];
  /** Stable string for the resolved capabilities; equal keys mean byte-identical platform text. */
  readonly key: string;

  constructor(parts: {
    kind: string;
    kinds: readonly string[];
    static: CapabilitySection;
    resolved: CapabilitySection;
    warnings?: readonly string[];
  }) {
    this.kind = parts.kind;
    this.kinds = Object.freeze([...parts.kinds]);
    this.static = parts.static;
    this.resolved = parts.resolved;
    this.warnings = Object.freeze([...(parts.warnings ?? [])]);
    const before = leafPaths(parts.static);
    const after = leafPaths(parts.resolved);
    this.narrowed = Object.freeze([...before]
      .filter(([path, value]) => !after.has(path) || stableJson(after.get(path)) !== stableJson(value))
      .map(([path]) => path)
      .sort());
    this.key = stableJson(parts.resolved);
    Object.freeze(this);
  }

  /** The value at `path`, or `undefined` when absent or switched off. */
  get<T = unknown>(path: string): T | undefined {
    let node: unknown = this.resolved;
    for (const key of path.split('.')) {
      if (!isRecord(node)) return undefined;
      if (key in node) node = node[key];
      else if (isRecord(node.params) && key in node.params) node = node.params[key];
      else return undefined;
    }
    return node === false ? undefined : node as T;
  }

  /** True when the capability is declared and not narrowed away (a `false` flag counts as absent). */
  has(path: string): boolean {
    const value = this.get(path);
    return value !== undefined && value !== null;
  }

  toJSON(): CapabilitySection {
    return this.resolved;
  }
}

// ---------------------------------------------------------------------------------------------
// Back-compat: a profile derived from legacy declarations
// ---------------------------------------------------------------------------------------------

const BUILTIN_SCOPES: readonly ProfileScope[] = ['private', 'group', 'channel'];

export interface LegacyAdapterDeclaration {
  readonly capabilities: readonly AdapterCapability[];
  readonly operations?: readonly AdapterOperation[];
  readonly segments?: AdapterSegmentPolicy;
}

/**
 * Conservative profile for an Adapter that declares none: only what `capabilities`, `operations` and
 * `segments` already say; every other capability is unsupported.
 */
export function deriveLegacyProfile(legacy: LegacyAdapterDeclaration): AdapterCapabilityProfile {
  const operations = new Set(legacy.operations ?? []);
  const reaction = legacy.segments?.reaction;
  const reactionScopes = reaction?.scopes ?? BUILTIN_SCOPES;
  const section: Record<string, unknown> = {};
  const messaging: Record<string, unknown> = {};
  if (legacy.segments) messaging.segments = legacy.segments;
  if (operations.has('recall')) messaging.recall = {};
  if (operations.has('edit')) messaging.edit = true;
  if (operations.has('reaction')) {
    const emojis = reaction?.values.map((item) => item.value);
    messaging.reaction = emojis && emojis.length > 0 ? { emojis } : {};
  }
  if (Object.keys(messaging).length > 0) section.messaging = messaging;
  const actions: Record<string, unknown> = {};
  if (operations.has('recall')) actions.recall = { scopes: BUILTIN_SCOPES };
  if (operations.has('reaction')) {
    const emojis = reaction?.values.map((item) => item.value);
    actions.reaction = {
      scopes: reactionScopes,
      ...(emojis && emojis.length > 0 ? { params: { emojis } } : {}),
    };
  }
  if (Object.keys(actions).length > 0) section.actions = actions;
  // Feedback follows the control ports the Endpoint already has: native typing first, then reactions.
  if (operations.has('typing')) section.feedback = { mode: 'typing' };
  else if (operations.has('reaction')) section.feedback = { mode: 'reaction' };
  // Undeclared Adapters keep the historic outbound behaviour: large inline media is spooled to disk
  // (an Adapter whose peer cannot read local paths declares `delivery.spool: false`).
  if (legacy.capabilities.includes('outbound')) section.delivery = { send: true, spool: true };
  if (legacy.capabilities.includes('liveDanmaku')) section.events = { liveDanmaku: true };
  return Object.freeze({ default: section as CapabilitySection });
}

/** Operations a declared profile implies (so `operations` need not be declared a second time). */
export function operationsImpliedByProfile(
  profile: AdapterCapabilityProfile,
): readonly AdapterOperation[] {
  const sections = [profile.default, profile.private, profile.group, profile.channel, profile.thread,
    ...Object.values(profile.kinds ?? {})];
  const implied = new Set<AdapterOperation>();
  for (const section of sections) {
    if (!section) continue;
    if (section.actions?.recall || section.messaging?.recall) implied.add('recall');
    if (section.messaging?.edit) implied.add('edit');
    if (section.actions?.reaction || section.messaging?.reaction) implied.add('reaction');
    if (section.feedback?.mode === 'typing') implied.add('typing');
  }
  return Object.freeze([...implied]);
}

/** Every action a profile declares in any section. */
export function declaredProfileActions(profile: AdapterCapabilityProfile): readonly AdapterActionName[] {
  const sections = [profile.default, profile.private, profile.group, profile.channel, profile.thread,
    ...Object.values(profile.kinds ?? {})];
  return Object.freeze(ADAPTER_ACTION_NAMES.filter((name) =>
    sections.some((section) => Boolean(section?.actions?.[name]))));
}

/**
 * Assembly-time check: every declared action needs its implementation port on the live Endpoint
 * (`control.*`, `management.*` or `send`). Declared without a port is an error.
 */
export function assertDeclaredProfileActions(
  endpoint: unknown,
  profile: AdapterCapabilityProfile,
  id: string,
  outbound: boolean,
): void {
  const holder = (endpoint && typeof endpoint === 'object' ? endpoint : {}) as {
    control?: Record<string, unknown>;
    management?: Record<string, unknown>;
  };
  for (const action of declaredProfileActions(profile)) {
    const port = ADAPTER_ACTION_PORTS[action];
    if (port.port === 'send') {
      if (!outbound) {
        throw new TypeError(`Adapter Endpoint ${id} profile declares actions.${action} but the adapter has no outbound capability`);
      }
    } else {
      const surface = port.port === 'control' ? holder.control : holder.management;
      if (!surface || typeof surface[port.method] !== 'function') {
        throw new TypeError(
          `Adapter Endpoint ${id} profile declares actions.${action} but ${port.port}.${port.method} is missing`,
        );
      }
    }
  }
}
