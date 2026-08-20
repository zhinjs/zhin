/**
 * Fallback types when `@icqqjs/icqq` peer is not installed.
 * Prefer package types when the real dependency is present.
 */
declare module '@icqqjs/icqq' {
  export interface Config extends Record<string, unknown> {
    sign_api_addr?: string;
    ver?: string;
    platform?: number;
    auto_server?: boolean;
    autoReconnect?: boolean;
  }

  export type Sendable = string | Record<string, unknown> | unknown[];

  export interface ParsedGroupMessageId {
    group_id: number;
    user_id: number;
    seq: number;
    rand: number;
    time: number;
    pktnum: number;
  }

  export function parseGroupMessageId(msgid: string): ParsedGroupMessageId;

  export interface GroupHandle {
    setReaction(seq: number, emoji: string): Promise<unknown>;
    delReaction(seq: number, reactionId: string): Promise<unknown>;
  }

  export interface FriendInfo {
    user_id: number;
    nickname: string;
    remark?: string;
  }

  export interface GroupInfo {
    group_id: number;
    group_name: string;
  }

  export interface GroupMemberInfo {
    user_id: number;
    nickname?: string;
    card?: string;
    role?: string;
  }

  export class Client {
    uin: number;
    fl: Map<number, FriendInfo>;
    gl: Map<number, GroupInfo>;
    config: Config;
    dir?: string;
    status?: number;

    constructor(uin?: number | Config, config?: Config);

    on(event: string, listener: (...args: unknown[]) => void): this;
    off(event: string, listener?: (...args: unknown[]) => void): this;
    emit(event: string, ...args: unknown[]): boolean;

    login(password?: string | number): Promise<void>;
    logout?(keepalive?: boolean): Promise<void>;
    terminate(): void;

    sendPrivateMsg(userId: number, message: Sendable): Promise<{ message_id?: unknown }>;
    sendGroupMsg(groupId: number, message: Sendable): Promise<{ message_id?: unknown }>;
    sendTempMsg(groupId: number, userId: number, message: Sendable): Promise<{ message_id?: unknown }>;
    sendGuildMsg(guildId: string, channelId: string, message: Sendable): Promise<{ message_id?: unknown }>;

    deleteMsg(messageId: string): Promise<boolean>;
    getSystemMsg(): Promise<unknown[]>;
    setFriendAddRequest(flag: string, approve: boolean, remark?: string): Promise<boolean>;
    setGroupAddRequest(flag: string, approve: boolean, reason?: string): Promise<boolean>;
    deleteFriend(userId: number): Promise<boolean>;
    setGroupKick(groupId: number, userId: number): Promise<boolean>;
    setGroupBan(groupId: number, userId: number, duration: number): Promise<boolean>;
    setGroupAdmin(groupId: number, userId: number, enabled: boolean): Promise<boolean>;
    getGroupMemberList(groupId: number): Promise<Map<number, GroupMemberInfo>>;

    getGuildList(): Array<{ guild_id: string; guild_name: string }>;
    getChannelList(guildId: string): Array<{ guild_id: string; channel_id: string; channel_name: string }>;

    pickGroup(groupId: number): GroupHandle;
  }
}
