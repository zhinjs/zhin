import { MessageItemType, type MessageItem } from './ilink-types.js';

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

