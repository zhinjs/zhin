import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { FontConfig } from './types.js';

interface WrapOptions {
  width: number;
  height?: number;
  backgroundColor: string;
  fontFamily: string;
  fontFaces?: string;
}

const TEMP_ROOT = path.join(os.tmpdir(), 'zhin-shotium');
const FONT_DIR = path.join(TEMP_ROOT, 'fonts');

function escapeCssValue(value: string): string {
  return value.replace(/[<>{};]/g, '');
}

function fontExtension(data: Buffer): string {
  const tag = data.subarray(0, 4).toString('ascii');
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'ttcf') return 'ttc';
  return 'ttf';
}

function toBuffer(data: ArrayBuffer | Buffer): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data));
}

function isHtmlBoundary(char: string | undefined): boolean {
  return char === undefined || char === '>' || /\s/.test(char);
}

function findOpeningTagEnd(html: string, tag: string): number {
  const lower = html.toLowerCase();
  const prefix = `<${tag}`;
  let start = lower.indexOf(prefix);
  while (start >= 0) {
    if (isHtmlBoundary(lower[start + prefix.length])) return html.indexOf('>', start + prefix.length);
    start = lower.indexOf(prefix, start + prefix.length);
  }
  return -1;
}

export function isFullDocument(html: string): boolean {
  const lower = html.toLowerCase();
  const doctype = lower.indexOf('<!doctype');
  if (doctype >= 0) {
    let cursor = doctype + '<!doctype'.length;
    while (/\s/.test(lower[cursor] ?? '')) cursor += 1;
    if (lower.startsWith('html', cursor) && isHtmlBoundary(lower[cursor + 4])) return true;
  }
  return findOpeningTagEnd(html, 'html') >= 0;
}

export function wrapDocument(html: string, options: WrapOptions): string {
  const fontFaces = options.fontFaces ?? '';

  if (isFullDocument(html)) {
    if (!fontFaces) return html;
    const style = `<style>${fontFaces}</style>`;
    const lower = html.toLowerCase();
    const headEnd = lower.indexOf('</head>');
    if (headEnd >= 0) return `${html.slice(0, headEnd)}${style}${html.slice(headEnd)}`;
    const bodyTagEnd = findOpeningTagEnd(html, 'body');
    if (bodyTagEnd >= 0) return `${html.slice(0, bodyTagEnd + 1)}${style}${html.slice(bodyTagEnd + 1)}`;
    return `${style}${html}`;
  }

  const height = options.height ? `min-height:${Math.round(options.height)}px;` : '';

  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8">',
    '<style>',
    fontFaces,
    '*,*::before,*::after{box-sizing:border-box}',
    'html,body{margin:0;padding:0}',
    `body{width:${Math.round(options.width)}px;${height}`,
    `background:${escapeCssValue(options.backgroundColor)};`,
    `font-family:${escapeCssValue(options.fontFamily)};`,
    '-webkit-font-smoothing:antialiased}',
    '</style></head><body>',
    html,
    '</body></html>',
  ].join('');
}

export function buildFontFaces(fonts: readonly FontConfig[]): string {
  if (fonts.length === 0) return '';

  const rules: string[] = [];
  for (const font of fonts) {
    const data = toBuffer(font.data);
    if (data.length === 0) continue;

    const hash = crypto.createHash('sha1').update(data).digest('hex').slice(0, 16);
    const file = path.join(FONT_DIR, `${hash}.${fontExtension(data)}`);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(FONT_DIR, { recursive: true });
      fs.writeFileSync(file, data);
    }

    rules.push(
      '@font-face{'
      + `font-family:"${escapeCssValue(font.name).replace(/"/g, '')}";`
      + `font-weight:${font.weight ?? 400};`
      + `font-style:${font.style === 'italic' ? 'italic' : 'normal'};`
      + 'font-display:block;'
      + `src:url("${pathToFileURL(file).href}")}`,
    );
  }
  return rules.join('');
}

export async function withDocumentFile<T>(
  document: string,
  run: (file: string) => Promise<T>,
): Promise<T> {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
  const name = `${process.pid}-${crypto.randomBytes(8).toString('hex')}.html`;
  const file = path.join(TEMP_ROOT, name);
  fs.writeFileSync(file, document, 'utf8');
  try {
    return await run(file);
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}
