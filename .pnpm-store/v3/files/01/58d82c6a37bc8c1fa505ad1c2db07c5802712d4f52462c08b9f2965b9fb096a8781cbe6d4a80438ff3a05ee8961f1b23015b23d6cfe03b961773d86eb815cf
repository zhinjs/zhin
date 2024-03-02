import { Encodable } from "../core/protobuf/index";
/** 支持的音乐平台 */
export type MusicPlatform = 'qq' | '163' | 'migu' | 'kugou' | 'kuwo';
type AppInfo = {
    appid: number;
    package_name: string;
    sign: string;
    name: string;
    icon?: string;
    getMusicInfo: typeof getQQSong;
};
export type MusicFullInfo = {
    title: string;
    singer: string;
    jumpUrl: string;
    musicUrl: string;
    preview: string;
};
export declare const musicFactory: Record<MusicPlatform, AppInfo>;
declare function getQQSong(id: string): Promise<MusicFullInfo>;
/**
 * 构造频道b77音乐分享
 * @param channel_id {string} 子频道id
 * @param guild_id {string} 频道id
 * @param platform 音乐平台
 * @param id 音乐id
 */
export declare function buildMusic(channel_id: string, guild_id: string, platform: MusicPlatform, id: string): Promise<Encodable>;
/**
 * 构造b77音乐分享
 * @param target {number} 群id或者好友qq
 * @param bu {0|1} 类型表示：0 为好友 1 为群
 * @param platform 音乐平台
 * @param id 音乐id
 */
export declare function buildMusic(target: number, bu: 0 | 1, platform: MusicPlatform, id: string): Promise<Encodable>;
export declare function makeMusicJson(musicInfo: MusicFullInfo & {
    platform: MusicPlatform;
}): {
    app: string;
    config: {
        type: string;
        autosize: boolean;
        forward: boolean;
    };
    desc: string;
    meta: {
        [x: string]: {
            app_type: number;
            appid: number;
            desc: string;
            jumpUrl: string;
            musicUrl: string;
            preview: string;
            sourceMsgId: string;
            source_icon: string | undefined;
            source_url: string;
            tag: string;
            title: string;
        };
    };
    prompt: string;
    ver: string;
    view: string;
};
export {};
