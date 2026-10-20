import { readFile } from 'node:fs/promises';
import { EndpointDeliveryError, isMediaRef, type MessageRef } from '@zhin.js/im-contract';
import type { EndpointSendRequest } from 'zhin.js/adapter';
import { formatOutboundKmarkdown } from './protocol.js';
import type { KookClientTransport } from './ws.js';

/** Native cards preserve mixed text/images; SDK's ordinary segments stop at first media. */
export async function sendKookOutbound(client: KookClientTransport, { conversation, payload }: EndpointSendRequest): Promise<string> {
  try {
    const items = Array.isArray(payload) ? payload : payload && typeof payload === 'object' ? [payload] : [payload];
    let quote: { message_id: string } | undefined;
    const modules: unknown[] = [];
    let hasImage = false;
    let hasCard = false;
    for (const item of items) {
      if (item && typeof item === 'object' && item.type === 'reply') {
        if (typeof item.data?.message_id === 'string' && item.data.message_id.trim()) quote = { message_id: item.data.message_id };
        continue;
      }
      if (item && typeof item === 'object' && item.type === 'keyboard') {
        hasCard = true;
        const rows = item.data?.rows;
        if (!Array.isArray(rows) || !rows.length) throw new EndpointDeliveryError('invalid_payload', 'KOOK keyboard requires button rows', 'not_sent');
        for (const row of rows) {
          if (!Array.isArray(row) || !row.length || row.length > 4) throw new EndpointDeliveryError('invalid_payload', 'KOOK button rows require 1-4 buttons', 'not_sent');
          const elements = row.map(button => {
            if (!button || typeof button !== 'object' || typeof button.label !== 'string' || !button.label.trim() || typeof button.payload !== 'string' || !button.payload) throw new EndpointDeliveryError('invalid_payload', 'KOOK buttons require label and payload', 'not_sent');
            if (button.disabled || button.mode === 'command') throw new EndpointDeliveryError('unsupported_operation', 'KOOK disabled/command buttons are not implemented', 'not_sent');
            return { type: 'button', theme: button.style === 'danger' ? 'danger' : button.style === 'primary' ? 'primary' : 'secondary',
              value: button.payload, click: 'return-val', text: { type: 'plain-text', content: button.label } };
          });
          modules.push({ type: 'action-group', elements });
        }
      } else if (item && typeof item === 'object' && item.type === 'share') {
        hasCard = true;
        const data = item.data ?? {};
        let url: URL;
        try { url = new URL(data.url); } catch { throw new EndpointDeliveryError('invalid_payload', 'KOOK share requires an HTTP(S) URL', 'not_sent'); }
        if (!['http:', 'https:'].includes(url.protocol) || typeof data.title !== 'string' || !data.title.trim()) throw new EndpointDeliveryError('invalid_payload', 'KOOK share requires URL and title', 'not_sent');
        if (['image', 'audio', 'artist', 'duration', 'config'].some(key => data[key] !== undefined)) throw new EndpointDeliveryError('unsupported_operation', 'KOOK share media/app metadata is not implemented', 'not_sent');
        modules.push({ type: 'section', mode: 'left', text: { type: 'plain-text', content: data.title } });
        for (const value of [data.description, data.content]) if (typeof value === 'string' && value) modules.push({ type: 'section', mode: 'left', text: { type: 'plain-text', content: value } });
        modules.push({ type: 'action-group', elements: [{ type: 'button', theme: 'secondary', click: 'link', value: url.href, text: { type: 'plain-text', content: '打开链接' } }] });
      } else if (item && typeof item === 'object' && item.type === 'image') {
        hasImage = true;
        const media = item.data?.media;
        if (!isMediaRef(media)) throw new EndpointDeliveryError('unsupported_media', 'KOOK image requires canonical media', 'rejected');
        let url: string;
        if (media.kind === 'file') url = media.value;
        else {
          if (!client.uploadMedia) throw new EndpointDeliveryError('unsupported_media', 'KOOK transport cannot upload images', 'rejected');
          let bytes: Buffer;
          if (media.kind === 'base64') bytes = Buffer.from(media.value.replace(/^data:[^,]*,/, ''), 'base64');
          else if (media.kind === 'path') bytes = await readFile(media.value);
          else {
            const response = await fetch(media.value, { signal: AbortSignal.timeout(30_000) });
            if (!response.ok) throw new EndpointDeliveryError('media_download_failed', 'KOOK media download failed', 'rejected');
            bytes = Buffer.from(await response.arrayBuffer());
          }
          url = await client.uploadMedia(bytes);
        }
        if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new EndpointDeliveryError('delivery_unconfirmed', 'KOOK upload returned no media URL', 'unknown');
        modules.push({ type: 'container', elements: [{ type: 'image', src: url, alt: String(item.data?.alt ?? 'image') }] });
      } else {
        if (item && typeof item === 'object' && ['file', 'audio', 'video'].includes(item.type)
          && isMediaRef(item.data?.media) && !['url', 'file'].includes(item.data.media.kind)) {
          throw new EndpointDeliveryError('unsupported_media', 'KOOK binary uploads currently support images only', 'rejected');
        }
        const text = formatOutboundKmarkdown([item]);
        if (text) modules.push({ type: 'section', mode: 'left', text: { type: 'kmarkdown', content: text } });
      }
    }
    const body = hasImage || hasCard ? { __isCard: true, type: 'card', theme: 'secondary', size: 'lg', modules } : formatOutboundKmarkdown(payload);
    const result = conversation.kind === 'private'
      ? await client.sendPrivateMsg(conversation.id, body, quote)
      : await client.sendChannelMsg(conversation.id, body, quote);
    const id = result?.msg_id != null ? String(result.msg_id) : '';
    if (!id.trim()) throw new EndpointDeliveryError('delivery_unconfirmed', 'KOOK did not return a real message ID', 'unknown');
    return id;
  } catch (error) {
    if (error instanceof EndpointDeliveryError) throw error;
    // Installed SDK discards HTTP metadata; its exact numerical rejection prefix is safe to recover.
    const code = error instanceof Error ? /error with code\((\d+)\):/.exec(error.message)?.[1] : undefined;
    if (code && Number(code) !== 408 && !(Number(code) >= 500 && Number(code) < 600)) throw new EndpointDeliveryError('platform_rejected', `KOOK request rejected (code=${code})`, 'rejected');
    throw new EndpointDeliveryError('delivery_unconfirmed', 'KOOK outbound outcome is unknown', 'unknown');
  }
}


/** Deletion requires the canonical conversation: KOOK has separate channel/private APIs. */
export async function recallKookMessage(client: KookClientTransport, message: MessageRef): Promise<void> {
  if (!message.id.trim()) throw new EndpointDeliveryError('invalid_message_id', 'KOOK recall requires a message ID', 'rejected');
  try {
    let deleted: boolean;
    if (message.conversation.kind === 'private') {
      if (!client.recallPrivateMsg) throw new EndpointDeliveryError('unsupported_operation', 'KOOK transport cannot delete private messages', 'rejected');
      deleted = await client.recallPrivateMsg(message.conversation.id, message.id);
    } else {
      if (!client.recallChannelMsg) throw new EndpointDeliveryError('unsupported_operation', 'KOOK transport cannot delete channel messages', 'rejected');
      deleted = await client.recallChannelMsg(message.conversation.id, message.id);
    }
    if (deleted !== true) throw new EndpointDeliveryError('platform_rejected', 'KOOK did not confirm message deletion', 'rejected');
  } catch (error) {
    if (error instanceof EndpointDeliveryError) throw error;
    const code = error instanceof Error ? /error with code\((\d+)\):/.exec(error.message)?.[1] : undefined;
    if (code && Number(code) !== 408 && !(Number(code) >= 500 && Number(code) < 600)) throw new EndpointDeliveryError('platform_rejected', `KOOK deletion rejected (code=${code})`, 'rejected');
    throw new EndpointDeliveryError('delivery_unconfirmed', 'KOOK deletion outcome is unknown', 'unknown');
  }
}
