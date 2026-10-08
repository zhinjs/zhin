import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type { LarkSendBody, LarkWireSegment } from './protocol.js';

/** Feishu JSON card v1: ordered native rich text, link and button components. */
export function formatLarkCard(items: Array<string | LarkWireSegment>): LarkSendBody {
  const elements: unknown[] = [];
  let replyTo: string | undefined;
  for (const item of items) {
    if (typeof item === 'string') { elements.push({ tag: 'div', text: { tag: 'plain_text', content: item } }); continue; }
    const data = item.data ?? {};
    switch (item.type) {
      case 'reply': replyTo = String(data.message_id ?? '') || undefined; break;
      case 'text': elements.push({ tag: 'div', text: { tag: 'plain_text', content: String(data.text ?? data.content ?? '') } }); break;
      case 'markdown': elements.push({ tag: 'div', text: { tag: 'lark_md', content: String(data.content ?? data.text ?? '') } }); break;
      case 'image': {
        const media = data.media as { kind?: string; value?: string } | undefined;
        if (media?.kind !== 'file' || !media.value) throw unsupported();
        elements.push({ tag: 'img', img_key: media.value, alt: { tag: 'plain_text', content: 'Image' } }); break;
      }
      case 'share': {
        const url = String(data.url ?? '');
        if (!/^https?:\/\//.test(url)) throw unsupported();
        elements.push({ tag: 'div', text: { tag: 'plain_text', content: String(data.title ?? url) } });
        if (data.description) elements.push({ tag: 'div', text: { tag: 'plain_text', content: String(data.description) } });
        elements.push({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '打开链接' }, url }] }); break;
      }
      case 'keyboard': {
        const rows = data.rows as Array<Array<{ id?: string; label?: string; payload?: string; url?: string }>> | undefined;
        if (!Array.isArray(rows) || rows.length === 0) throw unsupported();
        for (const row of rows) {
          if (!Array.isArray(row) || !row.length || row.length > 5) throw unsupported();
          const actions = row.map(button => {
            if (!button.label || (!button.payload && !button.url)) throw unsupported();
            return { tag: 'button', text: { tag: 'plain_text', content: button.label },
              ...(button.url ? { url: button.url } : { value: { zhin_payload: button.payload, zhin_button_id: button.id } }) };
          });
          elements.push({ tag: 'action', actions });
        }
        break;
      }
      default: throw unsupported();
    }
  }
  // JSON 1.0 lark_md does not render inline code. Use the SDK's JSON 2.0
  // markdown component for Markdown cards; keep validated v1 action cards.
  const hasMarkdown = items.some(item => typeof item !== 'string' && item.type === 'markdown');
  const hasActions = items.some(item => typeof item !== 'string' && ['share', 'keyboard'].includes(item.type));
  if (hasMarkdown && hasActions) throw new EndpointDeliveryError('unsupported_operation', 'Mixed Markdown and action cards require JSON 2.0 action support', 'not_sent');
  if (hasMarkdown) {
    const bodyElements = elements.map(element => {
      const row = element as { tag: string; text?: { tag: string; content: string } };
      if (row.tag !== 'div') return element;
      const text = row.text!;
      return { tag: 'markdown', content: text.tag === 'lark_md' ? text.content : text.content.replace(/[\\`*_{}[\]()#+.!|>~-]/g, '\\$&') };
    });
    return { msg_type: 'interactive', content: JSON.stringify({ schema: '2.0', body: { elements: bodyElements } }), ...(replyTo ? { replyTo } : {}) };
  }
  return { msg_type: 'interactive', content: JSON.stringify({ config: { wide_screen_mode: true }, elements }), ...(replyTo ? { replyTo } : {}) };
}
function unsupported() { return new EndpointDeliveryError('unsupported_operation', 'Unsupported or malformed Lark card segment', 'not_sent'); }

export interface LarkCardAction {
  readonly token?: string;
  readonly context?: { readonly open_message_id?: string; readonly open_chat_id?: string };
  readonly open_message_id?: string;
  readonly open_chat_id?: string;
  readonly operator?: { readonly open_id?: string; readonly user_id?: string };
  readonly action?: { readonly tag?: string; readonly value?: { readonly zhin_payload?: unknown; readonly zhin_button_id?: unknown } };
}
