import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { formatOutboundMail } from '../src/protocol.js';

const options = { from: 'bot@example.com', to: 'recipient@example.com' };

describe('Email rich multipart delivery', () => {
  it('composes real MIME with semantic Markdown, escaped text, share links and inline images in order', async () => {
    const mail = formatOutboundMail([
      { type: 'text', data: { text: '<unsafe>& before' } },
      { type: 'markdown', data: { content: '# 标题\n**加粗** and `code`\n- 第一项\n[文档](https://zhin.dev/)' } },
      { type: 'image', data: { media: { kind: 'base64', value: 'aGVsbG8=', file_name: 'sample.png' } } },
      { type: 'text', data: { text: 'after' } },
      { type: 'share', data: { title: '官网', url: 'https://zhin.dev/', description: '详情' } },
    ], options);
    // Public nodemailer stream transport generates MIME entirely locally.
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const sent = await transport.sendMail(mail);
    const parsed = await simpleParser(sent.message);
    expect(parsed.html).toContain('&lt;unsafe&gt;&amp; before');
    expect(parsed.html).toContain('<h1>标题</h1>');
    expect(parsed.html).toContain('<strong>加粗</strong>');
    expect(parsed.html).toContain('<code>code</code>');
    expect(parsed.html).toContain('<li>第一项</li>');
    expect(parsed.html).toContain('href="https://zhin.dev/"');
    expect(parsed.text).toContain('https://zhin.dev/');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]!.content.toString()).toBe('hello');
    expect(parsed.attachments[0]!.contentDisposition).toBe('inline');
    expect(parsed.attachments[0]!.cid).toBe(mail.attachments![0]!.cid);
    const html = String(mail.html);
    expect(html.indexOf('cid:')).toBeLessThan(html.indexOf('after'));
    expect(html.indexOf('before')).toBeLessThan(html.indexOf('cid:'));
    expect(sent.message.toString()).toContain('multipart/related');
    transport.close();
  });

  it('supports explicit HTML and image-only mail bodies with unique CIDs', () => {
    const html = formatOutboundMail({ type: 'html', data: { html: '<h2>邮件标题</h2><p>正文</p>' } }, options);
    expect(html.html).toContain('<h2>邮件标题</h2>');
    expect(html.text).toContain('正文');
    const image = { type: 'image', data: { media: { kind: 'base64', value: 'aGVsbG8=' } } };
    const first = formatOutboundMail([image, image], options);
    expect(first.html).toContain('cid:');
    expect(first.attachments![0]!.cid).not.toBe(first.attachments![1]!.cid);
  });

  it('rejects email Bot callbacks and unsupported share metadata before SMTP', () => {
    for (const type of ['keyboard', 'action']) expect(() => formatOutboundMail({ type, data: {} }, options)).toThrow(expect.objectContaining({ code: 'unsupported_operation', disposition: 'not_sent' }));
    expect(() => formatOutboundMail({ type: 'share', data: { title: 'x', url: 'javascript:alert(1)' } }, options)).toThrow();
    expect(() => formatOutboundMail({ type: 'share', data: { title: 'x', url: 'https://zhin.dev', image: 'x' } }, options)).toThrow(expect.objectContaining({ code: 'unsupported_operation' }));
  });
});
