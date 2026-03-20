// 消息段类型定义 - 客户端版本
export interface MessageSegment {
  /** record：如 ICQQ 语音等，展示时按音频处理 */
  type: 'text' | 'image' | 'at' | 'face' | 'video' | 'audio' | 'record' | 'file' | 'reply'
  data: Record<string, any>
}

// 消息元素别名（兼容不同命名习惯）
export type MessageElement = MessageSegment

// 发送内容类型
export type SendContent = MessageSegment | MessageSegment[] | string

