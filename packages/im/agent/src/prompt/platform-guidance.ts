/**
 * ADR 0044 §4: the platform description of the system prompt, generated from the turn's
 * `TurnCapabilities` with fixed zh/en templates.
 *
 * Split (ADR 0041 §5 cache): {@link buildStablePlatformGuidance} depends only on adapter + conversation
 * kind + static/role narrowing, so it is byte-identical across sessions of the same kind and goes in the
 * `platform` segment. {@link buildSceneDeliveryGuidance} carries what changes over time (passive window
 * remaining, current mute) and goes in the `scene` segment. Output is deterministic and ordered.
 */
import { getLogger } from '@zhin.js/logger';
import type { TurnCapabilities } from '@zhin.js/adapter';
import { labelThirdPartyGuidance } from './third-party-guidance.js';

const logger = getLogger('agent.platform-guidance');

export type PlatformGuidanceLocale = 'zh-CN' | 'en';

/** Adapter-authored `profile.prompt.text` is cut to this many characters. */
export const PLATFORM_CUSTOM_TEXT_MAX_CHARS = 600;
const EMOJI_SAMPLE = 4;

export interface PlatformGuidanceOptions {
  readonly locale?: PlatformGuidanceLocale;
  /** The adapter is not owned by the agent owner: its custom text is labelled `external_content` (#726). */
  readonly external?: boolean;
  /** Label source for external text, e.g. `adapter:icqq`. */
  readonly source?: string;
}

interface Words {
  title: string;
  adapterNotes: string;
  reactions: (sample: string, total: number) => string;
  maxLength: (n: number) => string;
  maxMessages: (n: number) => string;
  noMentionAll: string;
  noRecallOthers: string;
  recallOwn: (limit: string) => string;
  poke: string;
  mute: (range: string) => string;
  noMute: string;
  kick: string;
  noKick: string;
  passive: (window: string) => string;
  noProactive: string;
  sendDisabled: string;
  mutedUntil: (iso: string) => string;
  windowLeft: (parts: string) => string;
  seconds: (n: number) => string;
  messages: (n: number) => string;
  unit: { s: string; min: string; h: string; d: string };
}

const WORDS: Record<PlatformGuidanceLocale, Words> = {
  en: {
    title: '# Platform',
    adapterNotes: '## Adapter notes',
    reactions: (sample, total) => `Can react with emoji (${sample}${total > EMOJI_SAMPLE ? ', ...' : ''}; ${total} available).`,
    maxLength: (n) => `Max ${n} chars per message.`,
    maxMessages: (n) => `Max ${n} messages per turn.`,
    noMentionAll: 'Cannot @everyone.',
    noRecallOthers: "Cannot recall others' messages.",
    recallOwn: (limit) => `Can recall own messages${limit ? ` within ${limit}` : ''}.`,
    poke: 'Can poke.',
    mute: (range) => `Can mute members${range ? ` (${range})` : ''}.`,
    noMute: 'Cannot mute members (not admin).',
    kick: 'Can kick members.',
    noKick: 'Cannot kick members.',
    passive: (window) => `You can only reply within ${window} of a user message.`,
    noProactive: 'No proactive messages.',
    sendDisabled: 'You cannot send messages here right now (muted or reply window closed).',
    mutedUntil: (iso) => `Muted until ${iso}.`,
    windowLeft: (parts) => `Reply window left: ${parts}.`,
    seconds: (n) => `${n}s`,
    messages: (n) => `${n} msg`,
    unit: { s: 's', min: ' min', h: ' h', d: ' days' },
  },
  'zh-CN': {
    title: '# 平台',
    adapterNotes: '## 适配器补充',
    reactions: (sample, total) => `可表情回应（${sample}${total > EMOJI_SAMPLE ? '…' : ''}等${total}个）。`,
    maxLength: (n) => `单条最多${n}字。`,
    maxMessages: (n) => `每轮最多${n}条。`,
    noMentionAll: '不能 @ 全体。',
    noRecallOthers: '不能撤回他人消息。',
    recallOwn: (limit) => `可撤回自己的消息${limit ? `（${limit}内）` : ''}。`,
    poke: '可以戳一戳。',
    mute: (range) => `可禁言${range ? `（${range}）` : ''}。`,
    noMute: '不能禁言（非管理员）。',
    kick: '可踢人。',
    noKick: '不能踢人。',
    passive: (window) => `只能在用户消息后 ${window}内回复。`,
    noProactive: '不能主动发消息。',
    sendDisabled: '当前不能在此发消息（被禁言或回复窗口已关闭）。',
    mutedUntil: (iso) => `禁言至 ${iso}。`,
    windowLeft: (parts) => `回复窗口剩余：${parts}。`,
    seconds: (n) => `${n} 秒`,
    messages: (n) => `${n} 条`,
    unit: { s: '秒', min: '分钟', h: '小时', d: '天' },
  },
};

function duration(seconds: number, w: Words): string {
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400}${w.unit.d}`;
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600}${w.unit.h}`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}${w.unit.min}`;
  return `${seconds}${w.unit.s}`;
}

function range(value: { min?: number; max?: number } | undefined, w: Words): string {
  if (!value) return '';
  const { min, max } = value;
  if (min !== undefined && max !== undefined) return `${duration(min, w)}–${duration(max, w)}`;
  if (max !== undefined) return `≤ ${duration(max, w)}`;
  if (min !== undefined) return `≥ ${duration(min, w)}`;
  return '';
}

function words(locale: PlatformGuidanceLocale | undefined): Words {
  return WORDS[locale === 'zh-CN' ? 'zh-CN' : 'en'];
}

/** Behaviour-relevant lines only, in a fixed order. */
function autoLines(caps: TurnCapabilities, w: Words): string[] {
  const lines: string[] = [];
  const declared = caps.static;
  if (caps.has('actions.reaction') || caps.has('messaging.reaction')) {
    const emojis = caps.get<readonly string[]>('actions.reaction.emojis')
      ?? caps.get<readonly string[]>('messaging.reaction.emojis')
      ?? [];
    lines.push(w.reactions(emojis.slice(0, EMOJI_SAMPLE).join(' '), emojis.length));
  }
  const maxLength = caps.get<number>('messaging.maxLength');
  if (maxLength !== undefined) lines.push(w.maxLength(maxLength));
  const maxMessages = caps.get<number>('messaging.maxMessagesPerTurn');
  if (maxMessages !== undefined) lines.push(w.maxMessages(maxMessages));
  const mention = caps.resolved.messaging?.mention;
  if (mention && mention.all !== true) lines.push(w.noMentionAll);
  if (declared.messaging?.recall !== undefined || declared.actions?.recall !== undefined) {
    if (caps.has('actions.recall') || caps.has('messaging.recall')) {
      const limit = caps.get<number>('actions.recall.timeLimitSeconds')
        ?? caps.get<number>('messaging.recall.timeLimitSeconds');
      lines.push(w.recallOwn(limit !== undefined ? duration(limit, w) : ''));
    }
    const others = caps.get<boolean>('actions.recall.others') ?? caps.get<boolean>('messaging.recall.others');
    if (others !== true) lines.push(w.noRecallOthers);
  }
  if (caps.has('actions.poke')) lines.push(w.poke);
  if (declared.actions?.mute) {
    lines.push(caps.has('actions.mute')
      ? w.mute(range(caps.get('actions.mute.durationSeconds'), w))
      : w.noMute);
  }
  if (declared.actions?.kick) lines.push(caps.has('actions.kick') ? w.kick : w.noKick);
  // The static window only; what is left of it is time-varying and lives in the scene segment.
  const passive = declared.delivery?.passiveWindow;
  if (passive) {
    const parts = [
      passive.seconds !== undefined ? duration(passive.seconds, w) : '',
      passive.maxMessages !== undefined ? w.messages(passive.maxMessages) : '',
    ].filter(Boolean).join(' / ');
    if (parts) lines.push(w.passive(parts));
    if (declared.delivery?.proactive !== true) lines.push(w.noProactive);
  }
  return lines;
}

let truncationWarned = false;

/** Test hook: re-arm the warn-once latch. */
export function resetPlatformGuidanceWarnings(): void {
  truncationWarned = false;
}

function customText(caps: TurnCapabilities): string {
  const text = caps.get<string>('prompt.text');
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length <= PLATFORM_CUSTOM_TEXT_MAX_CHARS) return trimmed;
  if (!truncationWarned) {
    truncationWarned = true;
    logger.warn(`adapter profile.prompt.text is ${trimmed.length} chars; truncated to ${PLATFORM_CUSTOM_TEXT_MAX_CHARS}`);
  }
  return trimmed.slice(0, PLATFORM_CUSTOM_TEXT_MAX_CHARS);
}

/**
 * The stable `platform` segment text: auto-generated lines (unless `prompt.auto === false`) plus the
 * adapter's custom text. `null` when there is nothing to say.
 */
export function buildStablePlatformGuidance(
  caps: TurnCapabilities | undefined,
  options: PlatformGuidanceOptions = {},
): string | null {
  if (!caps) return null;
  const w = words(options.locale);
  const lines = caps.resolved.prompt?.auto === false ? [] : autoLines(caps, w);
  const text = customText(caps);
  if (lines.length === 0 && !text) return null;
  const out: string[] = [];
  if (lines.length > 0) out.push(w.title, ...lines.map((line) => `- ${line}`));
  if (text) {
    out.push(
      lines.length > 0 ? w.adapterNotes : w.title,
      options.external ? labelThirdPartyGuidance(options.source ?? 'adapter', text) : text,
    );
  }
  return out.join('\n');
}

/**
 * The `scene` segment text: delivery state that changes over time. `null` when delivery is exactly what
 * the static profile promises.
 */
export function buildSceneDeliveryGuidance(
  caps: TurnCapabilities | undefined,
  options: Pick<PlatformGuidanceOptions, 'locale'> & { readonly mutedUntil?: number } = {},
): string | null {
  if (!caps || caps.resolved.prompt?.auto === false) return null;
  const w = words(options.locale);
  const lines: string[] = [];
  const delivery = caps.resolved.delivery;
  const declared = caps.static.delivery;
  if (declared?.send !== false && delivery?.send === false) {
    lines.push(w.sendDisabled);
    if (typeof options.mutedUntil === 'number' && options.mutedUntil > 0) {
      lines.push(w.mutedUntil(new Date(options.mutedUntil).toISOString()));
    }
  }
  const total = declared?.passiveWindow;
  const left = delivery?.passiveWindow;
  if (total && left && (left.seconds !== total.seconds || left.maxMessages !== total.maxMessages)) {
    const parts = [
      left.seconds !== undefined ? w.seconds(left.seconds) : '',
      left.maxMessages !== undefined ? w.messages(left.maxMessages) : '',
    ].filter(Boolean).join(' / ');
    if (parts) lines.push(w.windowLeft(parts));
  }
  return lines.length > 0 ? lines.join(' ') : null;
}
