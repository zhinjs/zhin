import type { ConversationRef } from '@zhin.js/im-contract';
import { createTelegramStreaming } from '../src/streaming.js';
import { TelegramClient } from '../src/telegram-client.js';
import { resolveTelegramConfig } from '../src/protocol.js';
import { markdownToTelegramHtml } from '../src/markdown-to-html.js';
import { telegramHtmlText as visible } from './telegram-html-text.js';

const conversation: ConversationRef = { endpoint: { id: 'telegram', adapter: 'telegram' }, kind: 'private', id: '1' };

function fixture() {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fetch = vi.fn(async (url: string, init?: { body?: string | FormData }) => {
    const method = url.slice(url.lastIndexOf('/') + 1);
    calls.push({ method, body: JSON.parse(String(init?.body)) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true,
      result: method === 'sendMessageDraft' ? true : { message_id: 42 } }), json: async () => ({}) };
  });
  const client = new TelegramClient({ config: resolveTelegramConfig({ id: 'fixture', token: 'synthetic' }), fetch });
  return { calls, fetch, streaming: createTelegramStreaming(() => client) };
}

describe('Telegram private-chat drafts', () => {
  it('keeps draft and final Markdown projection consistent, with one final send and the same topic', async () => {
    const { streaming, calls } = fixture();
    const stream = streaming.open({ conversation: { ...conversation, threadId: '7' }, format: 'markdown',
      prefix: [{ type: 'reply', data: { message_id: '9' } }] })!;
    expect(await stream.write('**first**')).toEqual({ status: 'preview', acceptedText: '**first**' });
    await stream.write('**first**');
    const finished = stream.finish('**first** second');
    expect(stream.finish('**first** second')).toBe(finished);
    expect(await finished).toEqual({ status: 'sent', acceptedText: '**first** second', messageId: '42' });
    expect(calls).toMatchObject([
      { method: 'sendMessageDraft', body: { chat_id: 1, text: '<b>first</b>', parse_mode: 'HTML', message_thread_id: 7 } },
      { method: 'sendMessage', body: { chat_id: 1, text: '<b>first</b> second', parse_mode: 'HTML', message_thread_id: 7,
        reply_parameters: { message_id: 9 } } },
    ]);
    expect(calls[0].body.draft_id).toBeGreaterThan(0);
    expect(calls[0].body).not.toHaveProperty('reply_parameters');
  });

  it('uses one draft id for multiple preview revisions', async () => {
    const { streaming, calls } = fixture();
    const stream = streaming.open({ conversation, format: 'text' })!;
    await stream.write('first');
    await stream.write('first second');
    expect(calls.map(call => call.body.text)).toEqual(['first', 'first second']);
    expect(calls.map(call => call.body.draft_id)).toEqual([calls[0].body.draft_id, calls[0].body.draft_id]);
  });

  it('cancels previews without publishing a partial message', async () => {
    const { streaming, calls } = fixture();
    const stream = streaming.open({ conversation, format: 'text' })!;
    await stream.write('partial');
    stream.cancel();
    await expect(stream.finish('partial')).rejects.toMatchObject({ code: 'endpoint_inactive' });
    expect(calls.map(call => call.method)).toEqual(['sendMessageDraft']);
  });

  it('does not expose group drafts or move a grouped private conversation to another target', () => {
    const { streaming, calls } = fixture();
    expect(streaming.supports!({ conversation })).toBe(true);
    expect(streaming.supports!({ conversation: { ...conversation, kind: 'group' } })).toBe(false);
    expect(streaming.supports!({ conversation: { ...conversation, parent: { kind: 'group', id: 'parent' } } })).toBe(false);
    expect(streaming.open({ conversation: { ...conversation, kind: 'group' }, format: 'text' })).toBeUndefined();
    expect(streaming.open({ conversation: { ...conversation, parent: { kind: 'group', id: 'parent' } }, format: 'text' })).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('does not repeat an unknown final send even after a successful preview', async () => {
    const { streaming, fetch } = fixture();
    const stream = streaming.open({ conversation, format: 'text' })!;
    await stream.write('partial');
    fetch.mockRejectedValueOnce(new Error('socket closed'));
    await expect(stream.finish('partial final')).rejects.toMatchObject({ disposition: 'unknown' });
    await expect(stream.finish('partial final')).rejects.toMatchObject({ disposition: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('accepts an exact source prefix at the native text limit without splitting a Unicode character', async () => {
    const { streaming, calls } = fixture();
    const stream = streaming.open({ conversation, format: 'text' })!;
    const prefix = '😀'.repeat(4096);
    expect(await stream.write(`${prefix}tail`)).toMatchObject({ acceptedText: prefix, exhausted: true });
    expect(calls[0].body.text).toBe(prefix);
    await stream.finish(prefix);
    expect(calls[1].body.text).toBe(prefix);
  });

  it('continues long fenced Markdown across native containers without source or rendering loss', async () => {
    const { streaming, calls } = fixture();
    const original = `\`\`\`typescript\n${'const x = 1;\n'.repeat(800)}\`\`\``;
    let precedingText = '';
    while (precedingText.length < original.length) {
      const stream = streaming.open({ conversation, format: 'markdown', continuation: { precedingText } })!;
      const preview = await stream.write(original.slice(precedingText.length));
      expect(preview.acceptedText.length).toBeGreaterThan(0);
      const final = await stream.finish(preview.acceptedText);
      expect(final.acceptedText).toBe(preview.acceptedText);
      expect(final.contentUnavailable).toBe(true);
      precedingText += final.acceptedText;
    }
    expect(precedingText).toBe(original);
    expect(calls.length).toBeGreaterThan(4);
    for (let index = 0; index < calls.length; index += 2) {
      expect(calls[index].method).toBe('sendMessageDraft');
      expect(calls[index + 1].method).toBe('sendMessage');
      expect(calls[index + 1].body.text).toBe(calls[index].body.text);
      expect(calls[index].body.text).toMatch(/^<pre><code class="language-typescript">/);
      expect(calls[index].body.text).toMatch(/<\/code><\/pre>$/);
    }
  });

  it.each([
    `\`\`\`typescript\n${'x'.repeat(5000)}\n\`\`\``,
    `[${'x'.repeat(5000)}](https://example.invalid/report)`,
  ])('keeps oversized incomplete Markdown ephemeral until its final projection is known', async original => {
    const { streaming, calls } = fixture();
    const first = streaming.open({ conversation, format: 'markdown' })!;
    const partial = await first.write(original.slice(0, 4500));
    expect(partial.status).toBe('preview');
    expect(partial.exhausted).toBeUndefined();
    expect(calls.every(call => call.method === 'sendMessageDraft')).toBe(true);
    const closed = await first.write(original);
    expect(closed.acceptedText.startsWith(partial.acceptedText)).toBe(true);
    expect(closed.exhausted).toBeUndefined();
    const final = await first.finish(original);
    expect(final.acceptedText.startsWith(closed.acceptedText)).toBe(true);
    let precedingText = final.acceptedText;
    while (precedingText.length < original.length) {
      const next = streaming.open({ conversation, format: 'markdown', continuation: { precedingText } })!;
      const result = await next.finish(original.slice(precedingText.length));
      expect(result.acceptedText.length).toBeGreaterThan(0);
      precedingText += result.acceptedText;
    }
    expect(precedingText).toBe(original);
    const sent = calls.filter(call => call.method === 'sendMessage').map(call => String(call.body.text));
    expect(sent.map(visible).join('')).toBe(visible(markdownToTelegramHtml(original)));
  });
});
