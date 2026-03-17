/**
 * ICQQ 适配器类型与配置
 */
import type { Config, GroupRole, MemberInfo } from "@icqqjs/icqq";

export type { Config, GroupRole, MemberInfo };

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

export interface IcqqBotConfig extends Config {
  context: "icqq";
  name: `${number}`;
  password?: string;
  scope?: string;
}

export interface IcqqBot {
  $config: IcqqBotConfig;
}
