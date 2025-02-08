import { DiscussMessageEvent, GroupMessageEvent, GuildMessageEvent, PrivateMessageEvent } from '@icqqjs/icqq';

export type QQMessageEvent = PrivateMessageEvent | GroupMessageEvent | DiscussMessageEvent | GuildMessageEvent;
