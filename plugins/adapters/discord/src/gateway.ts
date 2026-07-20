import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  PermissionFlagsBits,
  type MessageCreateOptions,
  type Message as DiscordMessage,
} from 'discord.js';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  activityTypeCode,
  resolveChannelKind,
  type DiscordButtonInbound,
  type DiscordInboundMessage,
  type DiscordOutboundBody,
  type ResolvedDiscordGatewayConfig,
} from './protocol.js';

const logger = getLogger('discord');

export const DEFAULT_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessageReactions,
];

/** Minimal client surface used by the endpoint (real discord.js or test mock). */
export interface DiscordClientTransport {
  login(token: string): Promise<string>;
  destroy(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(): void;
  readonly user?: {
    readonly id: string;
    readonly tag?: string;
    setActivity?(name: string, options?: { type?: number; url?: string }): void;
  } | null;
  channels: {
    fetch(id: string): Promise<{
      id: string;
      type: number;
      isTextBased(): boolean;
      send?(options: MessageCreateOptions): Promise<{ id: string }>;
      messages?: {
        fetch(id: string): Promise<{
          react(emoji: string): Promise<unknown>;
          reactions: {
            resolve(emoji: unknown): { users: { remove(userId: string): Promise<unknown> } } | null;
            cache: { find(fn: (r: { emoji: { toString(): string; name?: string | null; id?: string | null } }) => boolean): { users: { remove(userId: string): Promise<unknown> } } | undefined };
          };
        }>;
      };
      threads?: {
        create(options: Record<string, unknown>): Promise<{ id: string }>;
      };
      availableTags?: Array<{ id: string; name: string }>;
    } | null>;
  };
  guilds: {
    fetch(id: string): Promise<{
      id: string;
      name: string;
      ownerId: string;
      memberCount: number;
      createdAt?: Date | null;
      iconURL?(options?: { size?: number }): string | null;
      roles: {
        fetch(): Promise<unknown>;
        cache: Map<string, {
          id: string;
          name: string;
          hexColor: string;
          position: number;
          permissions: { bitfield: bigint };
        }> | { map(fn: (role: {
          id: string;
          name: string;
          hexColor: string;
          position: number;
          permissions: { bitfield: bigint };
        }) => unknown): unknown[] };
      };
      members: {
        fetch(userId: string | { limit?: number }): Promise<unknown>;
        ban(userId: string, options?: { reason?: string; deleteMessageSeconds?: number }): Promise<unknown>;
        unban(userId: string, reason?: string): Promise<unknown>;
      };
    }>;
    cache: { values(): IterableIterator<{ id: string }> };
  };
}

export type CreateDiscordClient = (intents: readonly number[]) => DiscordClientTransport;

export function defaultCreateClient(intents: readonly number[]): DiscordClientTransport {
  return new Client({ intents: [...intents] }) as unknown as DiscordClientTransport;
}

export function resolveSenderRole(msg: DiscordInboundMessage): string | undefined {
  if (msg.isGuildOwner) return 'owner';
  const tokens = msg.permissionTokens ?? [];
  if (tokens.includes('ADMINISTRATOR') || tokens.includes('MODERATE_MEMBERS')) return 'admin';
  if (msg.guildId) return 'member';
  return undefined;
}

export function normalizeDiscordMessage(raw: unknown): DiscordInboundMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as DiscordMessage;
  if (!msg.author || !msg.channel) return null;

  const permissionTokens: string[] = [];
  let isGuildOwner = false;
  const member = msg.member;
  const guild = msg.guild;
  if (member && guild) {
    const checks: Array<[bigint, string]> = [
      [PermissionFlagsBits.Administrator, 'ADMINISTRATOR'],
      [PermissionFlagsBits.ManageRoles, 'MANAGE_ROLES'],
      [PermissionFlagsBits.ModerateMembers, 'MODERATE_MEMBERS'],
      [PermissionFlagsBits.ManageChannels, 'MANAGE_CHANNELS'],
      [PermissionFlagsBits.ManageGuild, 'MANAGE_GUILD'],
    ];
    for (const [bit, name] of checks) {
      if (member.permissions.has(bit)) permissionTokens.push(name);
    }
    if (guild.ownerId === msg.author.id) {
      isGuildOwner = true;
      permissionTokens.push('guild_owner', 'ADMINISTRATOR');
    }
  }

  return {
    id: msg.id,
    content: msg.content ?? '',
    channelId: msg.channel.id,
    channelKind: resolveChannelKind(msg.channel.type),
    authorId: msg.author.id,
    authorName: member?.displayName || msg.author.displayName || msg.author.username,
    authorBot: msg.author.bot,
    createdTimestamp: msg.createdTimestamp,
    guildId: guild?.id,
    isGuildOwner,
    permissionTokens,
    attachments: [...msg.attachments.values()].map((a) => ({
      id: a.id,
      name: a.name ?? undefined,
      url: a.url,
      contentType: a.contentType ?? undefined,
      size: a.size,
    })),
    embedTitles: msg.embeds.map((e) => e.title || e.description || 'embed').filter(Boolean) as string[],
    stickerNames: [...msg.stickers.values()].map((s) => s.name),
    replyToId: msg.reference?.messageId ?? undefined,
  };
}

export async function toMessageCreateOptions(body: DiscordOutboundBody): Promise<MessageCreateOptions> {
  const options: MessageCreateOptions = {};
  if (body.content) options.content = body.content;
  if (body.embeds?.length) {
    options.embeds = body.embeds.map((data) => {
      const embed = new EmbedBuilder();
      if (data.title) embed.setTitle(String(data.title));
      if (data.description) embed.setDescription(String(data.description));
      if (data.color != null) embed.setColor(data.color as number);
      if (data.url) embed.setURL(String(data.url));
      const thumb = data.thumbnail as { url?: string } | undefined;
      if (thumb?.url) embed.setThumbnail(thumb.url);
      const image = data.image as { url?: string } | undefined;
      if (image?.url) embed.setImage(image.url);
      if (data.author) embed.setAuthor(data.author as { name: string });
      if (data.footer) embed.setFooter(data.footer as { text: string });
      if (data.timestamp) embed.setTimestamp(new Date(String(data.timestamp)));
      if (Array.isArray(data.fields)) embed.addFields(data.fields as Array<{ name: string; value: string }>);
      return embed;
    });
  }
  if (body.files?.length) {
    const files: AttachmentBuilder[] = [];
    for (const file of body.files) {
      if (file.file && await fileExists(file.file)) {
        files.push(new AttachmentBuilder(createReadStream(file.file), {
          name: file.name || path.basename(file.file),
        }));
      } else if (file.url) {
        files.push(new AttachmentBuilder(file.url, { name: file.name || 'attachment' }));
      }
    }
    if (files.length) options.files = files;
  }
  if (body.components?.length) {
    options.components = body.components.map((row) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...row.components.map((btn) => {
          const b = new ButtonBuilder()
            .setCustomId(btn.custom_id)
            .setLabel(btn.label)
            .setDisabled(!!btn.disabled);
          if (btn.style === 4) b.setStyle(ButtonStyle.Danger);
          else if (btn.style === 1) b.setStyle(ButtonStyle.Primary);
          else b.setStyle(ButtonStyle.Secondary);
          return b;
        }),
      ),
    );
  }
  return options;
}

async function registerSlashCommands(
  config: ResolvedDiscordGatewayConfig,
  applicationId: string,
): Promise<void> {
  if (!config.slashCommands?.length) return;
  const rest = new REST({ version: '10' }).setToken(config.token);
  if (config.globalCommands) {
    await rest.put(Routes.applicationCommands(applicationId), {
      body: config.slashCommands,
    });
    logger.info(formatCompact({ op: 'slash_commands', scope: 'global' }));
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface DiscordGatewayConnectHandlers {
  onMessage(msg: DiscordInboundMessage): void;
  onButton(interaction: DiscordButtonInbound): void;
}

export async function connectDiscordGatewayClient(
  client: DiscordClientTransport,
  config: ResolvedDiscordGatewayConfig,
  handlers: DiscordGatewayConnectHandlers,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    client.on('messageCreate', (raw) => {
      const msg = normalizeDiscordMessage(raw);
      if (!msg) return;
      // clientReady 之后 client.user 一定可用；消息事件只会在此之后到达
      const botId = client.user?.id;
      const mentions = (raw as DiscordMessage).mentions;
      const mentionedBot = !!botId && mentions?.users?.has?.(botId) === true;
      handlers.onMessage(mentionedBot ? { ...msg, mentionedBot: true } : msg);
    });

    client.on('interactionCreate', (raw) => {
      const interaction = raw as {
        isButton?(): boolean;
        deferUpdate?(): Promise<unknown>;
        id: string;
        customId: string;
        channel?: { id: string; type: number } | null;
        user: { id: string; username?: string; displayName?: string };
        message?: { id: string };
      };
      if (!interaction.isButton?.()) return;
      void interaction.deferUpdate?.().catch(() => { /* already ack */ });
      if (!interaction.channel) return;
      handlers.onButton({
        id: interaction.id,
        customId: interaction.customId,
        channelId: interaction.channel.id,
        channelKind: resolveChannelKind(interaction.channel.type),
        userId: interaction.user.id,
        userName: interaction.user.username || interaction.user.displayName || interaction.user.id,
        sourceMessageId: interaction.message?.id,
      });
    });

    client.once('clientReady', () => {
      void (async () => {
        try {
          if (config.defaultActivity && client.user?.setActivity) {
            client.user.setActivity(config.defaultActivity.name, {
              type: activityTypeCode(config.defaultActivity.type),
              url: config.defaultActivity.url,
            });
          }
          if (config.enableSlashCommands && config.slashCommands?.length && client.user) {
            await registerSlashCommands(config, client.user.id);
          }
          if (!settled) {
            settled = true;
            resolve();
          }
        } catch (error) {
          if (!settled) {
            settled = true;
            reject(error);
          }
        }
      })();
    });

    client.on('error', (error) => {
      logger.error('Discord client error:', error);
      if (!settled) {
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    client.on('warn', (info) => {
      logger.warn('Discord client warning:', info);
    });

    client.login(config.token).catch((error) => {
      if (!settled) {
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
