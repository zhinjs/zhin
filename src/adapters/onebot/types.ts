import {SegmentElem} from "@";
import ActionMap = Types.ActionMap;

export namespace Types{
    export interface GroupInfo{
        group_id:string
        group_name:string
    }
    export interface UserInfo{
        user_id:string
        user_name:string
    }
    export interface DiscussInfo{
        discuss_id:string
        discuss_name:string
    }
    export interface GuildInfo{
        guild_id:string
        guild_name:string
    }
    export interface ChannelInfo{
        channel_id:string
        channel_name:string
    }
    export interface MessageInfo{
        message_id:string
        time:number
    }
    export type CanSendMessage=(Pick<UserInfo, 'user_id'> |
        Pick<GroupInfo,'group_id'> |
        Pick<DiscussInfo,'discuss_id'> |
        (Pick<GuildInfo,'guild_id'> & Pick<ChannelInfo,'channel_id'>)) & {message:SegmentElem[]}
    export interface ActionMap{
        send_message(params:CanSendMessage):MessageInfo
        delete_message(params:Pick<MessageInfo, 'message_id'>):void
        get_friend_list():UserInfo[]
        get_friend_info(params:Pick<UserInfo, 'user_id'>):UserInfo
        get_group_list():GroupInfo[]
        get_group_info(params:Pick<GroupInfo, 'group_id'>):GroupInfo
        get_group_member_list(params:Pick<GroupInfo, 'group_id'>):UserInfo[]
        get_group_member_info(params:Pick<GroupInfo, 'group_id'> & {member_id:string}):UserInfo
        get_discuss_list():DiscussInfo[]
        get_discuss_info(params:Pick<DiscussInfo, 'discuss_id'>):DiscussInfo
        get_guild_list():GuildInfo[]
        get_guild_info(params:Pick<GuildInfo, 'guild_id'>):GuildInfo
        get_channel_list(params:Pick<GuildInfo, 'guild_id'>):ChannelInfo[]
        get_channel_info(params:Pick<GuildInfo, 'guild_id'> & Pick<ChannelInfo, 'channel_id'>):ChannelInfo[]
    }
}
export interface OneBotPayload<T extends keyof ActionMap=keyof ActionMap>{
    action:T
    params?:Parameters<ActionMap[T]>[0]
    echo?:string|number
}
