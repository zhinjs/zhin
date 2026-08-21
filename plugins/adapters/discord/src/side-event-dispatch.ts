import { buildNotice, senderFromId } from '@zhin.js/core';
import type { SideEventGateway } from '@zhin.js/core/runtime';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';

export interface DiscordGuildMemberSideEvent {
  readonly guildId: string;
  readonly userId: string;
  readonly userName?: string;
}

export function receiveDiscordGuildMemberSideEvent(
  sideEvents: SideEventGateway | undefined,
  configId: string,
  kind: 'member_increase' | 'member_decrease',
  event: DiscordGuildMemberSideEvent,
  logger: ReturnType<typeof getAdapterLogger>,
): void {
  if (!sideEvents) return;
  void sideEvents.receiveNotice(buildNotice(event, {
    $id: `discord:guild_member:${kind}:${event.guildId}:${event.userId}:${Date.now()}`,
    $adapter: 'discord' as never,
    $endpoint: configId,
    $type: 'notice',
    $scene_id: event.guildId,
    $scene_type: 'group',
    $sub_type: kind,
    $actor: senderFromId(event.userId, event.userName),
    $timestamp: Date.now(),
  })).catch((err) => {
    logger.warn(formatCompact({
      op: 'discord_side_event_failed',
      endpoint: configId,
      event: kind,
      error: err instanceof Error ? err.message : String(err),
    }));
  });
}
