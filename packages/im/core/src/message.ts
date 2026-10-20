/**
 * 消息频道信息
 */
export interface MessageChannel{
    id: string;
    type: MessageType;
    /**
     * 私聊/子频道消息的来源场景：
     * - 群临时会话：type=private + parent.group
     * - QQ 子频道：type=channel + parent.guild
     */
    parent?: {
        type: 'group' | 'channel' | 'guild';
        id: string;
    };
}
/**
 * 消息类型枚举
 */
export type MessageType = 'group' | 'private' | 'channel'
