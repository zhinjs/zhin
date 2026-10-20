import { generateId } from './ilink-random.js';
import { MessageItemType, type WeixinMessage, type MessageItem } from './ilink-types.js';

function generateMessageSid(): string {
  return generateId('openclaw-weixin');
}

export type WeixinMsgContext = {
  Body: string;
  From: string;
  To: string;
  AccountId: string;
  OriginatingChannel: 'openclaw-weixin';
  OriginatingTo: string;
  MessageSid: string;
  Timestamp?: number;
  Provider: 'openclaw-weixin';
  ChatType: 'direct';
  SessionKey?: string;
  context_token?: string;
  MediaUrl?: string;
  MediaPath?: string;
  MediaType?: string;
  CommandBody?: string;
  CommandAuthorized?: boolean;
};

export function isMediaItem(item: MessageItem): boolean {
  return item.type === MessageItemType.IMAGE
    || item.type === MessageItemType.VIDEO
    || item.type === MessageItemType.FILE
    || item.type === MessageItemType.VOICE;
}

export function bodyFromItemList(itemList?: MessageItem[]): string {
  if (!itemList?.length) return '';
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return '';
}

export type WeixinInboundMediaOpts = {
  decryptedPicPath?: string;
  decryptedVoicePath?: string;
  voiceMediaType?: string;
  decryptedFilePath?: string;
  fileMediaType?: string;
  decryptedVideoPath?: string;
};

export function weixinMessageToMsgContext(
  msg: WeixinMessage,
  accountId: string,
  opts?: WeixinInboundMediaOpts,
): WeixinMsgContext {
  const fromUserId = msg.from_user_id ?? '';
  const ctx: WeixinMsgContext = {
    Body: bodyFromItemList(msg.item_list),
    From: fromUserId,
    To: fromUserId,
    AccountId: accountId,
    OriginatingChannel: 'openclaw-weixin',
    OriginatingTo: fromUserId,
    MessageSid: generateMessageSid(),
    Timestamp: msg.create_time_ms,
    Provider: 'openclaw-weixin',
    ChatType: 'direct',
  };
  if (msg.context_token) ctx.context_token = msg.context_token;

  if (opts?.decryptedPicPath) {
    ctx.MediaPath = opts.decryptedPicPath;
    ctx.MediaType = 'image/*';
  } else if (opts?.decryptedVideoPath) {
    ctx.MediaPath = opts.decryptedVideoPath;
    ctx.MediaType = 'video/mp4';
  } else if (opts?.decryptedFilePath) {
    ctx.MediaPath = opts.decryptedFilePath;
    ctx.MediaType = opts.fileMediaType ?? 'application/octet-stream';
  } else if (opts?.decryptedVoicePath) {
    ctx.MediaPath = opts.decryptedVoicePath;
    ctx.MediaType = opts.voiceMediaType ?? 'audio/wav';
  }
  return ctx;
}

export function getContextTokenFromMsgContext(ctx: WeixinMsgContext): string | undefined {
  return ctx.context_token;
}
