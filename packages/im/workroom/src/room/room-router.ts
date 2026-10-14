import type { RoomEntry, RoomMemberEntry } from './room-registry.js';

/** Why the router picked an Endpoint (structurally equal to core's RoomRouteDecision). */
export interface RoomRouteResult {
  readonly endpointId: string;
  readonly reason: 'pending' | 'mention' | 'reply' | 'coordinator' | 'role';
  /**
   * Other available members after the target, in takeover priority order
   * (generalist, then chat/general, then declaration order). The target is never included.
   * core lets them take over after a grace period when the target never receives a copy.
   */
  readonly fallbackEndpointIds: readonly string[];
}

/** Trusted facts about one inbound human message (structurally a subset of core's RoomInboundRouteInput). */
export interface RoomRouteFacts {
  readonly content: string;
  readonly mentionTargets: readonly string[];
  readonly replyToEndpointId?: string;
  pending(endpointId: string): boolean;
  accountOf(endpointId: string): string | undefined;
  isAvailable(endpointId: string): boolean;
}

/** Unicode-aware word characters (plus `-`), so a CJK alias is not matched as a prefix of a longer CJK name. */
const WORD = '\\p{L}\\p{N}_-';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Position of the first `@name` in text, case-insensitive, name delimited on both sides.
 * A text mention needs a separator after the name: `@研究 你好` and `@研究，` match, but `@研究`
 * does not match `@研究员`, and unspaced CJK like `@研究员帮我` does not match either. The reliable
 * path is the platform mention segment; text `@alias` is a convenience. Multiple mentions: the
 * first one wins (segments before text).
 */
function textMentionIndex(content: string, name: string): number {
  const pattern = new RegExp(`(?<![${WORD}])@${escapeRegExp(name)}(?![${WORD}])`, 'iu');
  const match = pattern.exec(content);
  return match ? match.index : -1;
}

/**
 * Members mentioned by the message, first mention first. Structured mention targets (platform
 * mention segments, matched on the member's Bot account) come before `@alias` text mentions,
 * because the platform vouches for them; text mentions are ordered by position.
 */
function mentionedMembers(room: RoomEntry, facts: RoomRouteFacts): RoomMemberEntry[] {
  const seen = new Set<RoomMemberEntry>();
  const ordered: RoomMemberEntry[] = [];
  const push = (member: RoomMemberEntry | undefined) => {
    if (member && !seen.has(member)) { seen.add(member); ordered.push(member); }
  };
  for (const target of facts.mentionTargets) push(room.memberByAccount(target, facts.accountOf));
  const textHits: Array<{ index: number; member: RoomMemberEntry }> = [];
  for (const member of room.members) {
    let best = -1;
    for (const name of member.names) {
      const index = textMentionIndex(facts.content, name);
      if (index >= 0 && (best < 0 || index < best)) best = index;
    }
    if (best >= 0) textHits.push({ index: best, member });
  }
  textHits.sort((a, b) => a.index - b.index);
  for (const hit of textHits) push(hit.member);
  return ordered;
}

/**
 * Pure routing decision for one inbound human message in a Room. Priority is fixed:
 * pending answer > mention > reply > coordinator > role match. Every step skips unavailable
 * Endpoints (falls through to the next priority); if nothing is available returns `undefined`
 * so the caller falls back to first-come dedup. The decision never depends on which Endpoint
 * received the copy or on its `mentioned` flag. A mention segment that points only to accounts
 * outside the Room yields no target (`undefined`), so it is not handed to the coordinator or role.
 */
export function routeRoomMessage(room: RoomEntry, facts: RoomRouteFacts): RoomRouteResult | undefined {
  const usable = (member: RoomMemberEntry | undefined): member is RoomMemberEntry =>
    member !== undefined && facts.isAvailable(member.endpointId);
  const available = room.members.filter(usable);
  const isGeneralist = (member: RoomMemberEntry) => member.role.accepts === undefined;
  const isChat = (member: RoomMemberEntry) =>
    member.role.accepts?.some((c) => c === 'chat' || c === 'general') === true;
  const fallbacksFor = (target: RoomMemberEntry): string[] => {
    const others = available.filter((member) => member !== target);
    return [
      ...others.filter(isGeneralist),
      ...others.filter((member) => !isGeneralist(member) && isChat(member)),
      ...others.filter((member) => !isGeneralist(member) && !isChat(member)),
    ].map((member) => member.endpointId);
  };
  const pick = (member: RoomMemberEntry | undefined, reason: RoomRouteResult['reason']): RoomRouteResult | undefined =>
    usable(member)
      ? { endpointId: member.endpointId, reason, fallbackEndpointIds: fallbacksFor(member) }
      : undefined;

  const pending = room.members.find((member) => usable(member) && facts.pending(member.endpointId));
  if (pending) return pick(pending, 'pending');

  // Only the first mentioned member counts; if it is unavailable, fall to the next priority.
  const mentioned = mentionedMembers(room, facts);
  const mention = pick(mentioned[0], 'mention');
  if (mention) return mention;

  if (facts.replyToEndpointId !== undefined) {
    const reply = pick(room.memberByEndpoint(facts.replyToEndpointId), 'reply');
    if (reply) return reply;
  }

  // The message is addressed to someone outside the Room: no target, so core falls back to
  // first-come dedup and member copies keep their original `mentioned` semantics.
  if (facts.mentionTargets.length > 0 && mentioned.length === 0) return undefined;

  const coordinator = pick(room.coordinator, 'coordinator');
  if (coordinator) return coordinator;

  // Role match (no coordinator, or it is unavailable): generalist first, then chat/general, then anyone.
  const generalist = available.find(isGeneralist);
  const chat = available.find(isChat);
  return pick(generalist ?? chat ?? available[0], 'role');
}
