/**
 * Discord Gateway protocol helpers — no legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface DiscordAdapterConfig {
  readonly name?: string;
  readonly token?: string;
  /** Default `gateway`. `interactions` uses httpHostToken POST + Ed25519 verify. */
  readonly connection?: 'gateway' | 'interactions';
  readonly intents?: readonly number[];
  readonly enableSlashCommands?: boolean;
  readonly globalCommands?: boolean;
  readonly defaultActivity?: {
    readonly name: string;
    readonly type: 'PLAYING' | 'STREAMING' | 'LISTENING' | 'WATCHING' | 'COMPETING';
    readonly url?: string;
  };
  readonly slashCommands?: readonly Record<string, unknown>[];
  /** Interactions-only fields. */
  readonly applicationId?: string;
  readonly publicKey?: string;
  readonly interactionsPath?: string;
  /** Transitional: legacy root `endpoints[]` with `context: discord`. */
  readonly endpoints?: ReadonlyArray<{
    readonly context?: string;
    readonly name?: string;
    readonly token?: string;
    readonly connection?: 'gateway' | 'interactions';
    readonly intents?: readonly number[];
    readonly enableSlashCommands?: boolean;
    readonly globalCommands?: boolean;
    readonly defaultActivity?: DiscordAdapterConfig['defaultActivity'];
    readonly slashCommands?: readonly Record<string, unknown>[];
    readonly applicationId?: string;
    readonly publicKey?: string;
    readonly interactionsPath?: string;
  }>;
}

export interface ResolvedDiscordGatewayConfig {
  readonly context: 'discord';
  readonly connection: 'gateway';
  readonly name: string;
  readonly token: string;
  readonly intents?: readonly number[];
  readonly enableSlashCommands: boolean;
  readonly globalCommands: boolean;
  readonly defaultActivity?: DiscordAdapterConfig['defaultActivity'];
  readonly slashCommands?: readonly Record<string, unknown>[];
}

export interface ResolvedDiscordInteractionsConfig {
  readonly context: 'discord';
  readonly connection: 'interactions';
  readonly name: string;
  readonly token: string;
  readonly applicationId: string;
  readonly publicKey: string;
  readonly interactionsPath: string;
}

export type ResolvedDiscordConfig =
  | ResolvedDiscordGatewayConfig
  | ResolvedDiscordInteractionsConfig;

export interface DiscordInboundAttachment {
  readonly id?: string;
  readonly name?: string;
  readonly url?: string;
  readonly contentType?: string;
  readonly size?: number;
}

export interface DiscordInboundMessage {
  readonly id: string;
  readonly content: string;
  readonly channelId: string;
  readonly channelKind: 'private' | 'group' | 'channel';
  readonly authorId: string;
  readonly authorName: string;
  readonly authorBot?: boolean;
  readonly createdTimestamp: number;
  readonly guildId?: string;
  readonly isGuildOwner?: boolean;
  readonly permissionTokens?: readonly string[];
  readonly attachments?: readonly DiscordInboundAttachment[];
  readonly embedTitles?: readonly string[];
  readonly stickerNames?: readonly string[];
  readonly replyToId?: string;
}

export interface DiscordButtonInbound {
  readonly id: string;
  readonly customId: string;
  readonly channelId: string;
  readonly channelKind: 'private' | 'group' | 'channel';
  readonly userId: string;
  readonly userName: string;
  readonly sourceMessageId?: string;
}

export interface DiscordWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface DiscordOutboundComponentButton {
  type: 2;
  custom_id: string;
  label: string;
  style: number;
  disabled?: boolean;
}

export interface DiscordOutboundActionRow {
  type: 1;
  components: DiscordOutboundComponentButton[];
}

export interface DiscordOutboundBody {
  readonly content?: string;
  readonly embeds?: ReadonlyArray<Record<string, unknown>>;
  readonly files?: ReadonlyArray<{
    name: string;
    url?: string;
    file?: string;
  }>;
  readonly components?: ReadonlyArray<DiscordOutboundActionRow>;
}

export function resolveDiscordConfig(config: DiscordAdapterConfig = {}): ResolvedDiscordConfig {
  const entry = config.endpoints?.find((item) => item.context === 'discord' || !item.context);
  const token = (typeof config.token === 'string' && config.token)
    || (typeof entry?.token === 'string' && entry.token)
    || process.env.DISCORD_BOT_TOKEN
    || '';
  if (!token) {
    throw new TypeError(
      'Discord adapter requires token (plugins.<key>.token or endpoints with context: discord)',
    );
  }
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.DISCORD_BOT_NAME
    || 'discord-bot';
  const connection = config.connection
    ?? entry?.connection
    ?? 'gateway';

  if (connection === 'interactions') {
    const applicationId = config.applicationId || entry?.applicationId || '';
    const publicKey = config.publicKey || entry?.publicKey || '';
    if (!applicationId || !publicKey) {
      throw new TypeError(
        'Discord connection:interactions requires applicationId and publicKey',
      );
    }
    return {
      context: 'discord',
      connection: 'interactions',
      name,
      token,
      applicationId,
      publicKey,
      interactionsPath: config.interactionsPath || entry?.interactionsPath || '/discord/interactions',
    };
  }

  return {
    context: 'discord',
    connection: 'gateway',
    name,
    token,
    intents: config.intents ?? entry?.intents,
    enableSlashCommands: config.enableSlashCommands === true
      || entry?.enableSlashCommands === true,
    globalCommands: config.globalCommands === true || entry?.globalCommands === true,
    defaultActivity: config.defaultActivity ?? entry?.defaultActivity,
    slashCommands: config.slashCommands ?? entry?.slashCommands,
  };
}

export function resolveChannelKind(channelType: number | string | undefined): 'private' | 'group' | 'channel' {
  // discord.js ChannelType.DM = 1, GroupDM = 3
  if (channelType === 1 || channelType === 'DM' || channelType === 'private') return 'private';
  if (channelType === 3 || channelType === 'GroupDM' || channelType === 'group') return 'group';
  return 'channel';
}

export function senderDisplayName(msg: DiscordInboundMessage): string {
  return msg.authorName || msg.authorId;
}

/** Build inbound text for MessageGateway.receive (gateway owns reply routing). */
export function formatInboundContent(msg: DiscordInboundMessage): string {
  const parts: string[] = [];
  if (msg.replyToId) parts.push(`[reply:${msg.replyToId}]`);
  if (msg.content?.trim()) parts.push(msg.content.trim());
  for (const attachment of msg.attachments ?? []) {
    const kind = attachment.contentType?.startsWith('image/')
      ? 'image'
      : attachment.contentType?.startsWith('audio/')
        ? 'audio'
        : attachment.contentType?.startsWith('video/')
          ? 'video'
          : 'file';
    const name = attachment.name || attachment.url || 'attachment';
    parts.push(`[${kind}: ${name}]`);
  }
  for (const title of msg.embedTitles ?? []) {
    parts.push(`[embed: ${title}]`);
  }
  for (const name of msg.stickerNames ?? []) {
    parts.push(`[sticker: ${name}]`);
  }
  const text = parts.join('\n').trim();
  return text || '(Empty message)';
}

export function formatButtonContent(interaction: DiscordButtonInbound): string {
  return `[action: ${interaction.customId}]`;
}

/**
 * Wire-encode an already-rendered outbound payload into Discord message body.
 * Segment canonicalization is intentionally not done here.
 */
export function formatOutboundBody(payload: unknown): DiscordOutboundBody {
  if (typeof payload === 'string') {
    return { content: payload };
  }

  const segments: Array<string | DiscordWireSegment> = Array.isArray(payload)
    ? payload as Array<string | DiscordWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as DiscordWireSegment]
      : [];

  if (segments.length === 0) {
    return {
      content: payload == null
        ? ''
        : typeof payload === 'object'
          ? JSON.stringify(payload)
          : String(payload),
    };
  }

  let content = '';
  const embeds: Record<string, unknown>[] = [];
  const files: Array<{ name: string; url?: string; file?: string }> = [];
  let components: DiscordOutboundBody['components'];

  for (const item of segments) {
    if (typeof item === 'string') {
      content += item;
      continue;
    }
    const data = item.data ?? {};
    switch (item.type) {
      case 'text':
        content += String(data.text ?? data.content ?? '');
        break;
      case 'at':
        content += `<@${String(data.id ?? '')}>`;
        break;
      case 'channel_mention':
        content += `<#${String(data.id ?? '')}>`;
        break;
      case 'role_mention':
        content += `<@&${String(data.id ?? '')}>`;
        break;
      case 'emoji':
        content += data.animated
          ? `<a:${String(data.name)}:${String(data.id)}>`
          : `<:${String(data.name)}:${String(data.id)}>`;
        break;
      case 'image':
      case 'audio':
      case 'video':
      case 'file': {
        const name = String(data.name || data.filename || item.type);
        if (typeof data.file === 'string' && data.file) {
          files.push({ name, file: data.file });
        } else if (typeof data.url === 'string' && data.url) {
          files.push({ name, url: data.url });
        }
        break;
      }
      case 'embed':
        embeds.push({ ...data });
        break;
      case 'keyboard': {
        const rows = (data.rows ?? []) as Array<Array<{
          label: string;
          payload: string;
          disabled?: boolean;
          style?: string;
        }>>;
        components = rows.map((row) => ({
          type: 1 as const,
          components: row.map((btn) => ({
            type: 2 as const,
            custom_id: String(btn.payload).slice(0, 100),
            label: btn.label,
            style: btn.style === 'danger' ? 4 : btn.style === 'primary' ? 1 : 2,
            disabled: !!btn.disabled,
          })),
        }));
        break;
      }
      default:
        if (data.text != null) content += String(data.text);
        break;
    }
  }

  return {
    ...(content.trim() ? { content: content.trim() } : {}),
    ...(embeds.length > 0 ? { embeds: embeds.slice(0, 10) } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(components ? { components } : {}),
  };
}

export function activityTypeCode(
  type: NonNullable<DiscordAdapterConfig['defaultActivity']>['type'],
): number {
  const map = {
    PLAYING: 0,
    STREAMING: 1,
    LISTENING: 2,
    WATCHING: 3,
    COMPETING: 5,
  } as const;
  return map[type] ?? 0;
}

export function verifyDiscordInteractionSignature(
  publicKeyHex: string,
  body: string,
  signature: string,
  timestamp: string,
): boolean {
  if (!publicKeyHex || !signature || !timestamp) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKeyHex, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    });
    return cryptoVerify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

export function formatSlashCommandContent(interaction: Record<string, unknown>): string {
  const data = interaction.data as {
    name?: string;
    options?: Array<{ name: string; value: unknown }>;
  } | undefined;
  const parts = [`/${data?.name ?? 'command'}`];
  for (const opt of data?.options ?? []) {
    parts.push(`${opt.name}:${String(opt.value)}`);
  }
  return parts.join(' ');
}

export function interactionToInboundMessage(interaction: Record<string, unknown>): DiscordInboundMessage {
  const user = (interaction.member as { user?: Record<string, unknown> } | undefined)?.user
    ?? (interaction.user as Record<string, unknown> | undefined);
  return {
    id: String(interaction.id),
    content: formatSlashCommandContent(interaction),
    channelId: String(interaction.channel_id ?? ''),
    channelKind: interaction.guild_id ? 'channel' : 'private',
    authorId: String(user?.id ?? ''),
    authorName: String(user?.username ?? user?.id ?? ''),
    createdTimestamp: Date.now(),
    guildId: interaction.guild_id != null ? String(interaction.guild_id) : undefined,
  };
}
