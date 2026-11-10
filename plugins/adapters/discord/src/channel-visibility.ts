/**
 * Discord 频道混淆（Channel Obfuscation）判定。
 *
 * 自 2026-11-16 起，Gateway 会继续下发机器人缺少 `VIEW_CHANNEL` 的频道，但其元数据被混淆：
 * `name` 变为 `"___hidden___"`，并在 `flags` 上置 `CHANNEL_OBFUSCATED`；HTTP 的
 * `GET /guilds/{guild.id}/channels` 则直接不返回这些频道。
 *
 * 出处：
 * - https://docs.discord.com/developers/resources/channel#channel-object-channel-flags
 *   （Channel Flags 表：`CHANNEL_OBFUSCATED` = `1 << 17`）
 * - https://docs.discord.com/developers/resources/channel#channel-object-obfuscated-channels
 * - https://docs.discord.com/developers/change-log （2026-08-12 "Channel Obfuscation for Users and Bots"）
 * - discord-api-types 上游 `ChannelFlags.ChannelObfuscated = 1 << 17`
 *   （payloads/v10/channel.ts）；但本仓库锁定的 discord.js 14.27.0 / discord-api-types 0.38.52
 *   的 `ChannelFlags` 尚未包含该值，因此这里用位运算自行判断。
 *
 * 官方要求以 flag 判定，不要依赖 `name` 等被混淆字段。
 *
 * TODO: discord-api-types 与 discord.js 发布 `ChannelFlags.ChannelObfuscated` 后，
 * 用该官方常量替换下面的 `1 << 17`。
 */
export const DISCORD_CHANNEL_FLAG_OBFUSCATED = 1 << 17;

type ChannelFlagsLike = number | bigint | { readonly bitfield?: number | bigint } | null | undefined;

function readFlagBits(flags: ChannelFlagsLike): number {
  if (flags == null) return 0;
  if (typeof flags === 'number') return flags;
  if (typeof flags === 'bigint') return Number(flags & 0xffffffffn);
  const bitfield = flags.bitfield;
  if (typeof bitfield === 'number') return bitfield;
  if (typeof bitfield === 'bigint') return Number(bitfield & 0xffffffffn);
  return 0;
}

/** 频道是否被 Discord 混淆（机器人无 `VIEW_CHANNEL`）。兼容 discord.js 的 `ChannelFlagsBitField` 与原始 `flags` 数值。 */
export function isDiscordChannelObfuscated(channel: { readonly flags?: unknown } | null | undefined): boolean {
  if (!channel) return false;
  return (readFlagBits(channel.flags as ChannelFlagsLike) & DISCORD_CHANNEL_FLAG_OBFUSCATED) !== 0;
}
