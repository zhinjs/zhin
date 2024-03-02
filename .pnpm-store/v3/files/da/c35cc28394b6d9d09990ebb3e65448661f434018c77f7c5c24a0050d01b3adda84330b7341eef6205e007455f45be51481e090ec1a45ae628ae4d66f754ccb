import { Encodable } from "../core/protobuf/index";
/** 所有可选参数，默认为QQ浏览器 */
export interface ShareConfig {
    appid?: number;
    appname?: string;
    /** app签名hash */
    appsign?: string;
}
/** 分享链接 */
export interface ShareContent {
    /** 跳转链接, 没有则发不出 */
    url: string;
    /** 链接标题 */
    title: string;
    /** 从消息列表中看到的文字，默认为 `"[分享]"+title` */
    content?: string;
    /** 预览图网址, 默认为QQ浏览器图标，似乎对域名有限制 */
    image?: string;
    summary?: string;
    audio?: string;
}
/**
 * 构造频道链接分享
 * @param channel_id 子频道id
 * @param guild_id 频道id
 * @param content 分享链接
 * @param config 分享配置
 */
export declare function buildShare(channel_id: string, guild_id: string, content: ShareContent, config?: ShareConfig): Encodable;
/**
 * 构造链接分享
 * @param target 群号或者好友账号
 * @param bu 类型表示：`0`为好友，`1`为群
 * @param content 分享链接
 * @param config 分享配置
 */
export declare function buildShare(target: number, bu: 0 | 1, content: ShareContent, config?: ShareConfig): Encodable;
