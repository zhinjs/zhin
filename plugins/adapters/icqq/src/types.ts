export type GroupRole = "owner" | "admin" | "member";

export interface IcqqSenderInfo {
  id: string;
  name: string;
  role?: GroupRole;
  isOwner?: boolean;
  isAdmin?: boolean;
  permissions?: string[];
  card?: string;
  title?: string;
}

export interface IcqqEndpointConfig {
  context: "icqq";
  name: `${number}`;
  autoReconnect?: boolean;
  outboundMedia?: "file" | "base64";
}

export interface FriendInfo {
  user_id: number;
  nickname: string;
  remark?: string;
  class_id?: number;
}

export interface GroupInfo {
  group_id: number;
  group_name: string;
  member_count: number;
  max_member_count: number;
  owner_id?: number;
}

export interface MemberInfo {
  user_id: number;
  nickname: string;
  card: string;
  role: GroupRole;
  title: string;
  join_time?: number;
  last_sent_time?: number;
  shutup_time?: number;
}

export interface SystemMessage {
  type: string;
  user_id?: number;
  nickname?: string;
  group_id?: number;
  group_name?: string;
  comment?: string;
  flag?: string;
  seq?: number;
  time?: number;
}
