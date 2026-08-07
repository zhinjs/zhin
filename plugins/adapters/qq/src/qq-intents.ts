/**
 * QQ 官方机器人 intents 与公域/私域映射。
 *
 * 群聊无公/私域之分，两类都订阅 `GROUP_AND_C2C_EVENT`。
 * 频道消息 intent 不同：
 * - public（公域）：`PUBLIC_GUILD_MESSAGES`（仅 @ 机器人）
 * - private（私域）：`GUILD_MESSAGES`（频道全量消息；公域订阅会 Identify 失败）
 */

export type QqBotKind = 'public' | 'private';

export type QqIntent =
  | 'GUILDS'
  | 'GUILD_MEMBERS'
  | 'GUILD_MESSAGES'
  | 'GUILD_MESSAGE_REACTIONS'
  | 'DIRECT_MESSAGE'
  | 'GROUP_AND_C2C_EVENT'
  | 'INTERACTION'
  | 'MESSAGE_AUDIT'
  | 'FORUMS_EVENT'
  | 'AUDIO_ACTION'
  | 'PUBLIC_GUILD_MESSAGES'
  | 'GROUP_MEMBER';

/** 扫码绑定 / 未声明 botKind 时的默认（公域更常见）。 */
export const DEFAULT_QQ_BOT_KIND: QqBotKind = 'public';

/** 公/私域共用：群@+私聊 C2C、频道基础事件、频道私信。 */
const QQ_SHARED_INTENTS = Object.freeze([
  'GROUP_AND_C2C_EVENT',
  'GUILDS',
  'GUILD_MEMBERS',
  'DIRECT_MESSAGE',
] as const satisfies readonly QqIntent[]);

export const QQ_INTENTS_BY_KIND: Readonly<Record<QqBotKind, readonly QqIntent[]>> = Object.freeze({
  public: Object.freeze([
    ...QQ_SHARED_INTENTS,
    'PUBLIC_GUILD_MESSAGES',
  ] as const),
  private: Object.freeze([
    ...QQ_SHARED_INTENTS,
    'GUILD_MESSAGES',
  ] as const),
});

/** 解析 botKind：仅接受 `public` / `private`。 */
export function parseQqBotKind(value: unknown): QqBotKind | undefined {
  if (value === 'public' || value === 'private') return value;
  return undefined;
}

/**
 * 解析最终 intents：显式 `intents` 优先；否则按 `botKind`（默认 public）展开。
 */
export function resolveQqIntents(input: {
  readonly intents?: readonly string[] | undefined;
  readonly botKind?: unknown;
}): readonly QqIntent[] {
  if (Array.isArray(input.intents) && input.intents.length > 0) {
    return Object.freeze(input.intents.map(String)) as readonly QqIntent[];
  }
  const kind = parseQqBotKind(input.botKind) ?? DEFAULT_QQ_BOT_KIND;
  return QQ_INTENTS_BY_KIND[kind];
}

/** 添加 endpoint 时写入配置的默认字段（显式展开，便于用户改）。 */
export function defaultQqEndpointIntentFields(
  botKind: QqBotKind = DEFAULT_QQ_BOT_KIND,
): { readonly botKind: QqBotKind; readonly intents: readonly QqIntent[] } {
  return Object.freeze({
    botKind,
    intents: QQ_INTENTS_BY_KIND[botKind],
  });
}
