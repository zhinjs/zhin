import { GuildMessageRet } from "./internal";
import { Guild } from "./guild";
import { MusicPlatform, Sendable } from "./message";
import { ShareConfig, ShareContent } from "./message/share";
/** 通知类型 */
export declare enum NotifyType {
    /** 未知类型 */
    Unknown = 0,
    /** 所有消息 */
    AllMessages = 1,
    /** 不通知 */
    Nothing = 2
}
/** 子频道类型 */
export declare enum ChannelType {
    /** 未知类型 */
    Unknown = 0,
    /** 文字频道 */
    Text = 1,
    /** 语音频道 */
    Voice = 2,
    /** 直播频道 */
    Live = 5,
    /** @todo 未知类型 */
    App = 6,
    /** 论坛频道 */
    Forum = 7
}
/** 子频道 */
export declare class Channel {
    readonly guild: Guild;
    readonly channel_id: string;
    /** 子频道名 */
    channel_name: string;
    /** 频道类型 */
    channel_type: ChannelType;
    /** 通知类型 */
    notify_type: NotifyType;
    constructor(guild: Guild, channel_id: string);
    get c(): import("./client").Client;
    _renew(channel_name: string, notify_type: NotifyType, channel_type: ChannelType): void;
    /** 发送网址分享 */
    shareUrl(content: ShareContent, config?: ShareConfig): Promise<void>;
    /** 发送音乐分享 */
    shareMusic(platform: MusicPlatform, id: string): Promise<void>;
    /**
     * 发送频道消息
     * 暂时仅支持发送： 文本、AT、表情
     */
    sendMsg(content: Sendable): Promise<GuildMessageRet>;
    /** 撤回频道消息 */
    recallMsg(seq: number): Promise<boolean>;
}
