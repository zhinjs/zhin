import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  SANDBOX_INBOUND_SYNTAX,
  expandSandboxInboundSyntax,
  parseSandboxInboundText,
  sandboxInboundFaceSegment,
  sandboxInboundMediaSegment,
  sandboxInboundMentionSegment,
} from '../src/inbound-syntax.js';
import { parseSandboxWsFrame, parseSandboxWsPayload } from '../src/protocol.js';

const self = { id: 'sandbox-bot', names: ['小助手'] };
const LOGO = 'https://github.com/zhinjs.png';

describe('Sandbox typed inbound syntax (#1250 sandbox-typed-media-syntax-sent-as-text)', () => {
  it('turns a typed [image:URL] into the image segment, not text', () => {
    const parsed = parseSandboxInboundText(`这是什么 [image:${LOGO}]`);
    expect(parsed.issues).toEqual([]);
    expect(parsed.segments).toEqual([
      { type: 'text', data: { text: '这是什么 ' } },
      { type: 'image', data: { media: { kind: 'url', value: LOGO } } },
    ]);
  });

  it('parses video, audio, file and face tokens into their segments', () => {
    const { segments } = parseSandboxInboundText(
      '[video:https://e.com/a.mp4][audio:https://e.com/a.mp3][file:https://e.com/docs/%E6%8A%A5%E5%91%8A.pdf][face:14]',
    );
    expect(segments).toEqual([
      { type: 'video', data: { media: { kind: 'url', value: 'https://e.com/a.mp4' } } },
      { type: 'audio', data: { media: { kind: 'url', value: 'https://e.com/a.mp3' } } },
      { type: 'file', data: { media: { kind: 'url', value: 'https://e.com/docs/%E6%8A%A5%E5%91%8A.pdf' }, name: '报告.pdf' } },
      { type: 'face', data: { id: 14 } },
    ]);
  });

  it('builds exactly what the composer buttons insert', () => {
    // The editor (RichTextEditor.tsx) builds its picked segments with the same builders.
    const single = (text: string) => {
      const { segments } = parseSandboxInboundText(text);
      expect(segments).toHaveLength(1);
      return segments[0];
    };
    expect(single(`[image:${LOGO}]`)).toEqual(sandboxInboundMediaSegment('image', LOGO));
    expect(single('[video:https://e.com/a.mp4]')).toEqual(sandboxInboundMediaSegment('video', 'https://e.com/a.mp4'));
    expect(single('[audio:https://e.com/a.mp3]')).toEqual(sandboxInboundMediaSegment('audio', 'https://e.com/a.mp3'));
    expect(single('[face:14]')).toEqual(sandboxInboundFaceSegment('14'));
    expect(single('[@alice]')).toEqual(sandboxInboundMentionSegment('alice'));
    // A pasted image (data URL) typed by hand is accepted like the paste button's result.
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    expect(single(`[image:${dataUrl}]`)).toEqual(sandboxInboundMediaSegment('image', dataUrl));
    // Inline media is a base64 ref (the Agent refuses `data:` as a network URL), with its MIME type.
    expect(sandboxInboundMediaSegment('image', dataUrl)).toEqual({
      type: 'image', data: { media: { kind: 'base64', value: dataUrl, mime_type: 'image/png' } },
    });
  });

  it('the editor builds picked segments with the shared builders (no DOM in this suite: source contract)', async () => {
    const source = await readFile(new URL('../pages/index/RichTextEditor.tsx', import.meta.url), 'utf8');
    const parse = source.slice(source.indexOf('const parseEditorContent'), source.indexOf('// 插入表情'));
    for (const builder of ['sandboxInboundFaceSegment(', "sandboxInboundMediaSegment('image'", "sandboxInboundMediaSegment('video'",
      "sandboxInboundMediaSegment('audio'", 'sandboxInboundMentionSegment(']) {
      expect(parse).toContain(builder);
    }
    expect(parse).not.toMatch(/media: \{ kind: 'url'/u);
  });

  it('keeps tokens with an unaccepted link as text and reports them', () => {
    for (const token of ['[image:not a url]', '[image:javascript:alert(1)]', '[image:/etc/passwd]', '[image:file:///etc/passwd]',
      '[video:data:image/png;base64,AAAA]', '[file:data:application/pdf;base64,AAAA]', '[audio:ftp://e.com/a.mp3]']) {
      const parsed = parseSandboxInboundText(`看 ${token}`);
      expect(parsed.expanded, token).toBe(false);
      expect(parsed.segments, token).toEqual([{ type: 'text', data: { text: `看 ${token}` } }]);
      expect(parsed.issues, token).toEqual([expect.objectContaining({ token, reason: 'invalid_url' })]);
    }
  });

  it('accepts only inline-renderable data: types and stores them in canonical form', () => {
    // Script-capable or unrendered types never become media with a declared MIME a consumer might trust.
    for (const token of ['[image:data:image/svg+xml;base64,PHN2Zz4=]', '[image:data:image/x-icon;base64,AAAA]',
      '[video:data:video/quicktime;base64,AAAA]', '[audio:data:audio/x-unknown;base64,AAAA]']) {
      const parsed = parseSandboxInboundText(token);
      expect(parsed.expanded, token).toBe(false);
      expect(parsed.issues, token).toEqual([expect.objectContaining({ token, reason: 'invalid_url' })]);
    }
    // Mixed case and whitespace in the payload are normalized, so the Console preview renders it too.
    expect(parseSandboxInboundText('[image:DATA:IMAGE/PNG;BASE64,iVBO Rw0K]').segments).toEqual([
      { type: 'image', data: { media: { kind: 'base64', value: 'data:image/png;base64,iVBORw0K', mime_type: 'image/png' } } },
    ]);
  });

  it('refuses links with control characters or credentials and stores the serialized link', () => {
    for (const token of ['[image:https://e.com/a\r.png]', '[image:https://e.com/\ta.png]', '[image:java\tscript:alert(1)]',
      '[image:https://user:secret@e.com/a.png]', '[file:https://user@e.com/a.pdf]']) {
      const parsed = parseSandboxInboundText(token);
      expect(parsed.expanded, JSON.stringify(token)).toBe(false);
      expect(parsed.issues, JSON.stringify(token)).toHaveLength(1);
    }
    expect(parseSandboxInboundText('[image: HTTPS://E.com/a b.png ]').segments).toEqual([
      { type: 'image', data: { media: { kind: 'url', value: 'https://e.com/a%20b.png' } } },
    ]);
  });

  it('a typed [file:URL] never carries a path in its name', () => {
    for (const link of ['https://e.com/%2e%2e%2fetc%2fpasswd', 'https://e.com/a%5C..%5Cb.txt', 'https://e.com/%2e%2e',
      'https://e.com/a%0Ab.txt', 'https://e.com/a%ZZ', 'https://e.com/']) {
      const [segment] = parseSandboxInboundText(`[file:${link}]`).segments;
      expect(segment?.type, link).toBe('file');
      expect(segment?.data, link).not.toHaveProperty('name');
      expect((segment?.data.media as { kind: string }).kind, link).toBe('url');
    }
    expect(parseSandboxInboundText('[file:https://e.com/d/%E6%8A%A5%E5%91%8A%20v2.pdf]').segments[0]?.data.name).toBe('报告 v2.pdf');
  });

  it('expands only text segments and leaves picked segments untouched', () => {
    const picked = sandboxInboundMediaSegment('image', LOGO);
    const result = expandSandboxInboundSyntax([picked, { type: 'text', data: { text: ' and [image:https://e.com/b.png]' } }]);
    expect(result.segments).toEqual([
      picked,
      { type: 'text', data: { text: ' and ' } },
      sandboxInboundMediaSegment('image', 'https://e.com/b.png'),
    ]);
    const untouched = [{ type: 'text', data: { text: 'a [b] c' } }];
    expect(expandSandboxInboundSyntax(untouched)).toEqual({ segments: untouched, issues: [], expanded: false });
  });

  it('the endpoint expands typed media like the page does, with no media token left in the text view', () => {
    const frame = parseSandboxWsFrame(JSON.stringify({ type: 'group', id: 'g', content: [
      { type: 'text', data: { text: `[@小助手] 这是什么 [image:${LOGO}]` } },
    ] }), self);
    expect(frame.kind).toBe('message');
    if (frame.kind !== 'message') return;
    expect(frame.message.content).toEqual([
      { type: 'mention', data: { target: 'sandbox-bot', name: '小助手' } },
      { type: 'text', data: { text: ' 这是什么 ' } },
      { type: 'image', data: { media: { kind: 'url', value: LOGO } } },
    ]);
    expect(frame.message.text).toBe('这是什么');
  });

  it('a typed image-only message equals a picked image-only message (and never falls back to the raw frame)', () => {
    const typed = parseSandboxWsPayload(JSON.stringify({ type: 'private', id: 'u', content: `[image:${LOGO}]` }), self);
    const picked = parseSandboxWsPayload(JSON.stringify({ type: 'private', id: 'u', content: [sandboxInboundMediaSegment('image', LOGO)] }), self);
    expect(typed.content).toEqual(picked.content);
    expect(typed.text).toBe('');
    expect(picked.text).toBe('');
  });

  it('the endpoint keeps a rejected token as text', () => {
    const parsed = parseSandboxWsPayload(JSON.stringify({ content: '看 [image:not a url]' }), self);
    expect(parsed.content).toEqual([{ type: 'text', data: { text: '看 [image:not a url]' } }]);
    expect(parsed.text).toBe('看 [image:not a url]');
  });
});

describe('「快捷操作与语法」 lists only what the parser supports (guard)', () => {
  it('every listed form parses into its declared segment', () => {
    for (const entry of SANDBOX_INBOUND_SYNTAX) {
      const parsed = parseSandboxInboundText(entry.example);
      expect(parsed.issues, entry.syntax).toEqual([]);
      expect(parsed.segments.map(segment => segment.type), entry.syntax).toEqual([entry.segmentType]);
      // The shown form and the example use the same token head.
      const head = entry.syntax.startsWith('[@') ? '[@' : entry.syntax.slice(0, entry.syntax.indexOf(':') + 1);
      expect(entry.example.startsWith(head), entry.syntax).toBe(true);
    }
  });

  it('every token head the parser accepts is listed', () => {
    const listed = new Set(SANDBOX_INBOUND_SYNTAX.map(entry => entry.kind));
    const probes: Record<string, string> = {
      mention: '[@x]', face: '[face:1]', image: `[image:${LOGO}]`, video: `[video:${LOGO}]`, audio: `[audio:${LOGO}]`,
      file: `[file:${LOGO}]`,
    };
    const accepted = Object.entries(probes).filter(([, token]) => parseSandboxInboundText(token).expanded).map(([kind]) => kind);
    expect(new Set(accepted)).toEqual(listed);
    // Unlisted heads stay text.
    for (const token of ['[record:https://e.com/a.amr]', '[reply:1]', '[at:1]', '[share:https://e.com]']) {
      expect(parseSandboxInboundText(token).expanded, token).toBe(false);
    }
  });

  it('the page renders the hint list from the parser table and hard-codes no other syntax', async () => {
    const source = await readFile(new URL('../pages/index/SandboxChat.tsx', import.meta.url), 'utf8');
    const hints = source.slice(source.indexOf('<details className="sandbox-hints">'), source.indexOf('</details>', source.indexOf('<details className="sandbox-hints">')));
    expect(hints).toContain('SANDBOX_INBOUND_SYNTAX.map(');
    const hardCoded = [...hints.matchAll(/<span className="sandbox-hint-key">([^<{]*)<\/span>/gu)].map(match => match[1]);
    // Keyboard operations only; every syntax key comes from the table.
    expect(hardCoded).toEqual(['Enter', 'Shift+Enter']);
    expect(hints).not.toMatch(/\[(image|video|audio|file|face):/u);
  });

  it('the send path and the preview use the shared parser', async () => {
    const source = await readFile(new URL('../pages/index/SandboxChat.tsx', import.meta.url), 'utf8');
    const send = source.slice(source.indexOf('const handleSendMessage = '), source.indexOf('const clearMessages = '));
    expect(send).toContain('expandSandboxInboundSyntax(editorSegments)');
    expect(send).toMatch(/content: segments/u);
    const preview = source.slice(source.indexOf('const parseTextToSegments = '), source.indexOf('const hasRenderableSegments'));
    expect(preview).toContain('parseSandboxInboundText(text)');
  });
});
