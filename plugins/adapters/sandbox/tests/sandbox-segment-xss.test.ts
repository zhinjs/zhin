import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from '@zhin.js/client';
import { renderSandboxSegment, renderSandboxSegments, type SandboxSegmentRenderContext } from '../pages/index/segments/index.js';

(globalThis as { React?: typeof React }).React = React;

const context = (patch: Partial<SandboxSegmentRenderContext> = {}): SandboxSegmentRenderContext => ({
  locale: 'zh-CN', isSent: false, interactionResolved: false, canInteract: true,
  sendAction: () => true, renderNested: (segments) => renderSandboxSegments(segments, context({ canInteract: false })),
  ...patch,
});
const render = (segment: unknown) =>
  renderToStaticMarkup(React.createElement(React.Fragment, null, renderSandboxSegment(segment, context(), 0)));
const markdown = (text: string) => renderToStaticMarkup(React.createElement(MarkdownContent, { text }));

/** Each tag of the markup with its attributes (values decoded); text content is never a tag. */
function tags(html: string): Array<{ name: string; attributes: Map<string, string> }> {
  return [...html.matchAll(/<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/gu)].map((match) => ({
    name: match[1]!.toLowerCase(),
    attributes: new Map([...match[2]!.matchAll(/\s+([\w:-]+)(?:="([^"]*)")?/gu)].map((attribute) => [
      attribute[1]!.toLowerCase(),
      (attribute[2] ?? '').replace(/&quot;/gu, '"').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&'),
    ])),
  }));
}

/** Every URL-bearing attribute in the markup, decoded. */
function urlAttributes(html: string): string[] {
  return tags(html).flatMap((tag) => ['href', 'src', 'action', 'formaction', 'xlink:href']
    .flatMap((name) => tag.attributes.has(name) ? [tag.attributes.get(name)!] : []));
}

const SCRIPT_SCHEMES = /^\s*(?:javascript|vbscript|data:(?!image\/(?:png|jpeg|gif|webp|avif);base64,|application\/octet-stream;base64,))/iu;

function expectInert(html: string): void {
  for (const tag of tags(html)) {
    expect(['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'style'], html).not.toContain(tag.name);
    for (const name of tag.attributes.keys()) expect(name, html).not.toMatch(/^on/u);
    // Every new-tab link drops the opener.
    if (tag.name === 'a' && tag.attributes.get('target') === '_blank') expect(tag.attributes.get('rel'), html).toMatch(/noreferrer|noopener/u);
  }
  for (const url of urlAttributes(html)) expect(url, url).not.toMatch(SCRIPT_SCHEMES);
}

const HOSTILE_URLS = [
  'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
  'vbscript:msgbox(1)', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+', 'data:image/png,<svg onload=alert(1)>',
  'java&#115;cript:alert(1)', 'https://example.com/a.png" onerror="alert(1)',
];

describe('Sandbox renderers stay inert on hostile segments (ADR 0064 G10)', () => {
  it('never emits raw HTML, script URLs or event handlers from Markdown', () => {
    const sources = [
      '<img src=x onerror=alert(1)><script>alert(1)</script>',
      ...HOSTILE_URLS.flatMap((url) => [`[x](${url})`, `![x](${url})`, `[![x](${url})](${url})`]),
      '[outer [inner](javascript:alert(1))](https://example.com)',
      '**[x](javascript:alert(1))** _![y](data:text/html,x)_ ~~[z](vbscript:x)~~',
      '- [ ] [task](javascript:alert(1))\n  - ![n](javascript:alert(1))',
      '| a |\n| --- |\n| [c](javascript:alert(1)) |',
      '```html\n<script>alert(1)</script>\n```',
    ];
    for (const source of sources) {
      const html = markdown(source);
      expectInert(html);
      expect(html).not.toContain('<img src="x"');
    }
    expect(markdown('<b onclick="x">hi</b>')).toContain('&lt;b onclick=&quot;x&quot;&gt;');
  });

  it('keeps hostile URLs out of every URL-bearing segment', () => {
    for (const url of HOSTILE_URLS) {
      const media = { kind: 'url', value: url };
      const segments = [
        { type: 'image', data: { media, url } }, { type: 'video', data: { media, url } },
        { type: 'audio', data: { media, url } }, { type: 'voice', data: { url } }, { type: 'record', data: { file: url } },
        { type: 'file', data: { media, name: 'a"><script>alert(1)</script>' } },
        { type: 'file', data: { media: { kind: 'base64', value: url }, name: 'x' } },
        { type: 'link', data: { url, text: 'x' } },
        { type: 'share', data: { url, title: 'x', image: url, audio: url } },
        { type: 'card', data: { title: 'x', image: url, description: `[d](${url})`, buttons: [{ id: 'b', label: url, url }] } },
        { type: 'qrcode', data: { text: url } }, { type: 'tts', data: { text: url } },
        { type: 'markdown', data: { content: `[m](${url}) ![i](${url})` } },
        { type: 'forward', data: { messages: [[{ type: 'image', data: { url } }, { type: 'link', data: { url } }]] } },
      ];
      for (const segment of segments) expectInert(render(segment));
    }
  });

  it('downloads inline files as octet-stream, whatever MIME the data URL claims', () => {
    const html = render({ type: 'file', data: { media: { kind: 'base64', value: 'data:text/html;base64,PHNjcmlwdD4=' }, name: 'x.html' } });
    expect(urlAttributes(html)).toEqual(['data:application/octet-stream;base64,PHNjcmlwdD4=']);
    expect(html).toContain('download="x.html"');
    expect(render({ type: 'file', data: { media: { kind: 'base64', value: 'PHNj"><b>' }, name: 'x' } })).not.toContain('href=');
  });

  it('renders malformed card / keyboard data instead of failing the whole page', () => {
    const malformed = [
      { type: 'card', data: { title: 't', fields: [null, 'x', 3, { label: 'ok', value: 'v' }], buttons: [null, 'b', { label: 'Go', payload: 'go' }] } },
      { type: 'card', data: { title: 't', buttons: 'not-a-list', actions: [undefined] } },
      { type: 'keyboard', data: { rows: 'not-rows' } },
      { type: 'keyboard', data: { rows: [null, 'row', [null, 7, { label: 'A', payload: 'a' }, { label: 'B' }]] } },
    ];
    for (const segment of malformed) expect(() => render(segment)).not.toThrow();
    const card = render(malformed[0]);
    expect(card).toContain('ok');
    expect(card).toContain('Go');
    const keyboard = render(malformed[3]);
    expect(keyboard.match(/<button/gu)).toHaveLength(1);
  });
});
