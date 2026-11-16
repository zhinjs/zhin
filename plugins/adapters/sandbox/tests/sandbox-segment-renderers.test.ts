import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OUTBOUND_SEGMENT_CATALOG, OUTBOUND_SEGMENT_TYPES } from '@zhin.js/core';
import { segmentsForImDelivery } from '@zhin.js/client';
import {
  SANDBOX_SEGMENT_RENDERERS,
  renderSandboxSegment,
  renderSandboxSegments,
  type SandboxSegmentRenderContext,
} from '../pages/index/segments/index.js';
import { formatFileSize, sandboxFileHref } from '../pages/index/segments/media.js';
import { qrCodePath } from '../pages/index/segments/qrcode.js';
import { safeLinkHref } from '../pages/index/segments/cards.js';

// The convention page is compiled with the automatic JSX runtime by pagemanager; vitest uses the classic one.
(globalThis as { React?: typeof React }).React = React;

const context = (patch: Partial<SandboxSegmentRenderContext> = {}): SandboxSegmentRenderContext => ({
  locale: 'zh-CN', isSent: false, interactionResolved: false, canInteract: true,
  sendAction: () => true, renderNested: (segments) => renderSandboxSegments(segments, context({ canInteract: false })),
  ...patch,
});

const render = (segment: unknown, patch?: Partial<SandboxSegmentRenderContext>) =>
  renderToStaticMarkup(React.createElement(React.Fragment, null, renderSandboxSegment(segment, context(patch), 0)));

describe('Sandbox segment renderers (ADR 0064 §2 / G6 / G7 / G10)', () => {
  it('has a dedicated renderer for exactly the outbound segment catalog', () => {
    // A segment added to Core's catalog without a Sandbox renderer fails here.
    expect(Object.keys(SANDBOX_SEGMENT_RENDERERS).sort()).toEqual([...OUTBOUND_SEGMENT_TYPES].sort());
    for (const type of OUTBOUND_SEGMENT_TYPES) expect(typeof SANDBOX_SEGMENT_RENDERERS[type], type).toBe('function');
  });

  it.each(OUTBOUND_SEGMENT_CATALOG.map((entry) => [entry.type, entry.example] as const))(
    'renders the %s example without falling back to [type]',
    (_type, example) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const html = render(example);
      expect(html).not.toContain('sandbox-segment-note');
      expect(html).not.toMatch(/\[(?:file|link|qrcode|tts|share|voice|record)\]/u);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    },
  );

  it('keeps third-party namespaced segments on the readable fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(render({ type: 'acme:poll', data: { text: 'Vote now' } })).toContain('Vote now');
    expect(render({ type: 'acme:blob', data: {} })).toContain('sandbox-segment-note');
    warn.mockRestore();
  });

  it('lays an HTML card without a width out at the 540px design width (G4 / D5)', () => {
    expect(render({ type: 'html', data: { html: '<b>card</b>' } })).toContain('width:540px');
    expect(render({ type: 'html', data: { html: '<b>menu</b>', width: 1080 } })).toContain('width:1080px');
  });

  it('renders a file card with its name, size and a download link (G6)', () => {
    const html = render(OUTBOUND_SEGMENT_CATALOG.find((entry) => entry.type === 'file')!.example);
    expect(html).toContain('sandbox-file-card');
    expect(html).toContain('report.pdf');
    expect(html).toContain('20 KB');
    expect(html).toContain('href="https://example.com/report.pdf"');
    expect(html).toContain('download="report.pdf"');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(-1)).toBeUndefined();
  });

  it('never turns file media into an active document or a script URL', () => {
    expect(sandboxFileHref({ kind: 'base64', value: 'aGVsbG8=' })).toBe('data:application/octet-stream;base64,aGVsbG8=');
    expect(sandboxFileHref({ kind: 'base64', value: 'data:text/html;base64,PGI+' })).toBe('data:application/octet-stream;base64,PGI+');
    expect(sandboxFileHref({ kind: 'url', value: 'javascript:alert(1)' })).toBeUndefined();
    expect(sandboxFileHref({ kind: 'url', value: 'https://user:pw@example.com/a' })).toBeUndefined();
    expect(sandboxFileHref({ kind: 'path', value: '/etc/passwd' })).toBeUndefined();
    expect(render({ type: 'file', data: { media: { kind: 'file', value: 'opaque-id' }, name: 'a.bin' } })).not.toContain('href=');
  });

  it('renders a link card and keeps unsafe link schemes inert (G6)', () => {
    const html = render({ type: 'link', data: { url: 'https://example.com/docs', text: 'Docs' } });
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('example.com');
    expect(render({ type: 'link', data: { url: 'javascript:alert(1)', text: 'x' } })).not.toContain('href=');
    expect(safeLinkHref('data:text/html,<b>')).toBeUndefined();
  });

  it('generates the QR code locally as an SVG of its modules (G6)', () => {
    const code = qrCodePath('https://example.com/login')!;
    expect(code.size).toBeGreaterThanOrEqual(21);
    expect(code.path).toMatch(/^M\d+ \d+h1v1h-1z/u);
    const html = render({ type: 'qrcode', data: { text: 'https://example.com/login' } });
    expect(html).toContain('<svg');
    expect(html).toContain('https://example.com/login');
    expect(html).not.toMatch(/<img[^>]+qrcode/u);
    expect(render({ type: 'qrcode', data: { text: 'x'.repeat(8000) } })).toContain('sandbox-qrcode-error');
  });

  it('shows TTS text with a read-aloud control (G6)', () => {
    const html = render({ type: 'tts', data: { text: 'Read this aloud' } });
    expect(html).toContain('Read this aloud');
    expect(html).toContain('朗读');
    expect(html).toContain('<button');
  });

  it('plays a music card audio with the media source checks (G7)', () => {
    const music = render(OUTBOUND_SEGMENT_CATALOG.find((entry) => entry.type === 'share')!.example);
    expect(music).toContain('<audio');
    expect(music).toContain('src="https://example.com/song.mp3"');
    expect(music).toContain('Song title');
    const unsafe = render({ type: 'share', data: { url: 'https://e.com', title: 't', audio: 'javascript:alert(1)' } });
    expect(unsafe).not.toContain('<audio');
  });

  it('renders forward records through the same registry, never interactively', () => {
    const html = render({ type: 'forward', data: { forward_id: 'f', messages: [[
      { type: 'text', data: { text: 'nested **bold**' } },
      { type: 'keyboard', data: { rows: [[{ id: 'a', label: 'A', payload: 'a' }]] } },
    ]] } });
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toMatch(/<button[^>]*\sdisabled=""/u);
  });

  it('mirrors the catalog in the Console client IM-visibility filter', () => {
    const examples = OUTBOUND_SEGMENT_CATALOG.map((entry) => entry.example);
    expect(segmentsForImDelivery(examples)).toEqual(examples);
  });
});
