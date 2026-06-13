/**
 * LINE Messaging API 类型定义
 */

export interface LineEndpointConfig {
  context: 'line'
  name: string
  channelSecret: string
  channelAccessToken: string
  webhookPath?: string
  apiBaseUrl?: string
}

export interface LineUser {
  userId: string
  displayName?: string
  pictureUrl?: string
  statusMessage?: string
}

export interface LineMessageEvent {
  type: 'message'
  replyToken: string
  source: LineSource
  timestamp: number
  message: LineMessage
}

export interface LineFollowEvent {
  type: 'follow'
  replyToken: string
  source: LineSource
  timestamp: number
}

export interface LineUnfollowEvent {
  type: 'unfollow'
  source: LineSource
  timestamp: number
}

export interface LineJoinEvent {
  type: 'join'
  replyToken: string
  source: LineSource
  timestamp: number
}

export interface LineLeaveEvent {
  type: 'leave'
  source: LineSource
  timestamp: number
}

export interface LinePostbackEvent {
  type: 'postback'
  replyToken: string
  source: LineSource
  timestamp: number
  postback: {
    data: string
    params?: Record<string, string>
  }
}

export type LineEvent =
  | LineMessageEvent
  | LineFollowEvent
  | LineUnfollowEvent
  | LineJoinEvent
  | LineLeaveEvent
  | LinePostbackEvent

export interface LineSource {
  type: 'user' | 'group' | 'room'
  userId?: string
  groupId?: string
  roomId?: string
}

export interface LineMessage {
  id: string
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'location' | 'sticker'
  text?: string
  fileName?: string
  fileSize?: number
  title?: string
  address?: string
  latitude?: number
  longitude?: number
  packageId?: string
  stickerId?: string
  stickerResourceType?: string
  duration?: number
}

export interface LineWebhookBody {
  destination: string
  events: LineEvent[]
}

export interface LineReplyMessage {
  type: 'text' | 'image' | 'video' | 'audio' | 'location' | 'sticker' | 'flex'
  text?: string
  originalContentUrl?: string
  previewImageUrl?: string
  packageId?: string
  stickerId?: string
  title?: string
  address?: string
  latitude?: number
  longitude?: number
  duration?: number
  altText?: string
  contents?: Record<string, unknown>
}

export interface LineReplyRequest {
  replyToken: string
  messages: LineReplyMessage[]
}

export interface LinePushRequest {
  to: string
  messages: LineReplyMessage[]
}

export interface LineApiResponse {
  sentMessages?: Array<{ id: string; quoteToken?: string }>
}
