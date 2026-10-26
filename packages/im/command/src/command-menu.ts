import type { Locale } from '@zhin.js/plugin-runtime';
import { commandMessages } from './messages.js';

export interface CommandMenuEntry {
  readonly name: string;
  readonly description?: string;
}

export interface CommandMenuAppearance {
  readonly title?: string;
  readonly subtitle?: string;
  readonly accentColor?: string;
  readonly backgroundImage?: string;
}

export interface CommandMenuSegment {
  readonly type: 'html';
  readonly data: {
    readonly html: string;
    readonly text: string;
    readonly width: number;
    readonly fileName: string;
  };
}

export const MENU_PAGE_SIZE = 30;

const escape = (value: string) => value.replace(/[&<>"']/gu, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char] ?? char);

/** Configuration is text/data, never an interpolated CSS or HTML fragment. */
export function readMenuAppearance(value: unknown): CommandMenuAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const result: { title?: string; subtitle?: string; accentColor?: string; backgroundImage?: string } = {};
  if (typeof input.title === 'string') result.title = input.title.slice(0, 100);
  if (typeof input.subtitle === 'string') result.subtitle = input.subtitle.slice(0, 160);
  if (typeof input.accentColor === 'string' && /^#[\da-f]{6}$/iu.test(input.accentColor)) result.accentColor = input.accentColor;
  if (typeof input.backgroundImage === 'string') {
    try {
      const url = new URL(input.backgroundImage);
      if (url.protocol === 'https:' || url.protocol === 'http:'
        || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u.test(url.href)) result.backgroundImage = url.href;
    } catch { /* Invalid optional artwork falls back to the bundled illustration. */ }
  }
  return result;
}

// Self-contained artwork: no network requests or extra asset/package dependency.
const landscape = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1400" viewBox="0 0 1080 1400">
<defs><linearGradient id="sky" x2=".8" y2="1"><stop stop-color="#162635"/><stop offset=".48" stop-color="#344b57"/><stop offset="1" stop-color="#70837c"/></linearGradient><radialGradient id="glow"><stop stop-color="#eddbc0" stop-opacity=".3"/><stop offset="1" stop-color="#d6d7c3" stop-opacity="0"/></radialGradient><linearGradient id="hill" x2="0" y2="1"><stop stop-color="#b2c2b5" stop-opacity=".34"/><stop offset="1" stop-color="#213e45" stop-opacity=".1"/></linearGradient></defs>
<path fill="url(#sky)" d="M0 0h1080v1400H0z"/><circle cx="820" cy="184" r="290" fill="url(#glow)"/><circle cx="823" cy="167" r="92" fill="#e3dfc9"/><circle cx="802" cy="146" r="10" fill="#cbcdbb" opacity=".3"/><circle cx="854" cy="194" r="19" fill="#cbcdbb" opacity=".3"/>
<g fill="#e7d5ac" opacity=".7"><circle cx="113" cy="72" r="1.5"/><circle cx="360" cy="104" r="1"/><circle cx="624" cy="55" r="2"/><circle cx="713" cy="265" r="1.2"/><circle cx="982" cy="332" r="2"/><circle cx="463" cy="43" r="1.4"/><circle cx="540" cy="202" r="1.4"/><circle cx="96" cy="410" r="2"/></g>
<g fill="none" stroke="#abac8a" stroke-width="2" opacity=".6"><path d="M1080 0Q959 77 902 267M1012 45Q916 92 866 106M984 78Q1016 164 1004 229M946 146Q866 156 838 204M917 217Q947 257 945 311"/></g>
<g fill="#d1bc93" opacity=".7"><ellipse cx="916" cy="84" rx="8" ry="21" transform="rotate(60 916 84)"/><ellipse cx="975" cy="115" rx="8" ry="20" transform="rotate(-25 975 115)"/><ellipse cx="876" cy="172" rx="8" ry="20" transform="rotate(58 876 172)"/><ellipse cx="1006" cy="208" rx="8" ry="20"/><ellipse cx="932" cy="270" rx="8" ry="20" transform="rotate(-25 932 270)"/></g>
<path d="M0 615 171 375 293 517 441 315 619 564 796 417 1080 651V1400H0Z" fill="url(#hill)"/><path d="m0 867 263-305 194 263 173-167 216 142 234-183v783H0Z" fill="#243e48" opacity=".46"/><path d="M0 1155q260-270 540-160t540-125v530H0Z" fill="#17343d" opacity=".65"/>
<g fill="none" stroke="#b1c1b2" stroke-opacity=".14"><path d="M0 455q210-85 424-12t656-4M0 474q210-85 424-12t656-4M0 1095q310-83 600-9t480-30M0 1124q310-83 600-9t480-30"/></g></svg>`;

const symbols = [
  '<path d="m16 3 4 9 9 4-9 4-4 9-4-9-9-4 9-4Z"/><path d="m16 10 2 6-2 6-2-6Z"/>',
  '<circle cx="16" cy="16" r="11"/><path d="m10 19 6-12 6 12-6-3Z"/>',
  '<path d="m16 3 12 7v12l-12 7-12-7V10Z"/><path d="m4 10 12 7 12-7M16 17v12"/>',
  '<circle cx="16" cy="16" r="5"/><path d="m16 2 3 7 8-3-3 8 7 2-7 3 3 8-8-3-3 7-3-7-8 3 3-8-7-3 7-2-3-8 8 3Z"/>',
];

function icon(name: string, plugin = false): string {
  const hash = [...name].reduce((value, char) => (value + (char.codePointAt(0) ?? 0)) % symbols.length, 0);
  return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.15">${plugin ? symbols[2] : symbols[hash]}</svg>`;
}

/** Presentation only: the unified outbound pipeline owns image rendering and fallback. */
export function renderCommandMenu(
  title: string,
  commands: readonly CommandMenuEntry[],
  children: readonly CommandMenuEntry[],
  hint: string | undefined,
  text: string,
  options: { readonly page?: number; readonly pages?: number; readonly locale?: Locale; readonly commandTotal?: number; readonly pluginTotal?: number; readonly appearance?: CommandMenuAppearance } = {},
): CommandMenuSegment {
  const locale = options.locale ?? 'zh-CN';
  const appearance = options.appearance ?? {};
  const background = appearance.backgroundImage ?? `data:image/svg+xml,${encodeURIComponent(landscape)}`;
  // CSS string escaping additionally prevents an artwork URL from closing <style>.
  const cssUrl = JSON.stringify(background).replace(/</gu, '\\3c ').replace(/>/gu, '\\3e ');
  const entries = (items: readonly CommandMenuEntry[], plugin: boolean) => items.map(item =>
    `<div class="entry"><div class="icon">${icon(item.name, plugin)}</div><div class="copy"><div class="name">${escape(item.name)}</div>${item.description
      ? `<div class="description">${escape(item.description)}</div>` : ''}</div></div>`).join('');
  const section = (label: string, items: readonly CommandMenuEntry[], total: number, plugin = false) => items.length === 0 ? ''
    : `<section><div class="section-head"><h2>${label}</h2><span>${items.length} / ${total}</span></div><div class="grid">${entries(items, plugin)}</div></section>`;
  const page = options.page ?? 1;
  const pages = options.pages ?? 1;

  return {
    type: 'html',
    data: {
      width: 1080, fileName: 'command-menu.png', text,
      html: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#253b46;color:#f4f0e6;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:18px;line-height:1.5;--accent:${appearance.accentColor ?? '#e7c993'}}
main{padding:42px 28px 24px;background-image:linear-gradient(180deg,#0c202a0a,#0c202a55),url(${cssUrl});background-size:cover;background-position:center top}
header{min-height:210px;padding:10px 22px 30px;position:relative}.eyebrow{font-size:12px;letter-spacing:5px;color:#f4e4c4;margin:0 0 17px}
h1{margin:0 0 10px;font-family:"Songti SC","Noto Serif CJK SC",serif;font-size:55px;font-weight:800;letter-spacing:3px;text-shadow:0 2px 16px #0c202a66;max-width:760px;line-height:1.2}
.subtitle{font-size:17px;color:#e0e6e0;letter-spacing:2px;max-width:700px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.summary{margin:18px 0 0;display:flex;align-items:center;gap:16px;font-size:13px;letter-spacing:1px;color:#e0dfcf}.summary i{width:22px;height:1px;background:var(--accent)}
section{margin:0 0 20px;padding:5px;background:#dbe9e516;border:1px solid #f0e2c722;border-radius:19px;box-shadow:0 8px 25px #08192312}.section-head{padding:14px 18px;display:flex;justify-content:space-between;align-items:center;background:#142a34db;border-radius:13px 13px 0 0}
h2{margin:0;font-size:20px;font-weight:700;letter-spacing:1px;color:var(--accent)}.section-head span{font-size:12px;letter-spacing:2px;color:#b7c7c5}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:#20363fdb;border-radius:0 0 13px 13px;overflow:hidden}
.entry{display:flex;align-items:center;gap:12px;padding:19px 17px;min-width:0;min-height:106px;border-top:1px solid #e7e6d614;border-right:1px solid #e7e6d614;background:linear-gradient(120deg,#ffffff08,#ffffff00)}.entry:nth-child(3n){border-right:0}
.icon{width:35px;height:35px;flex:0 0 35px;color:var(--accent);filter:drop-shadow(0 1px 6px #d9ba7c22)}.icon svg{display:block;width:100%;height:100%}.copy{min-width:0}.name{font-size:18px;font-weight:700;color:var(--accent)}.description{margin:4px 0 0;color:#e1e8e5;font-size:15px;line-height:1.45}
.name{overflow-wrap:anywhere;white-space:pre-wrap}.description,h1{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;white-space:pre-wrap}
footer{margin:6px 5px 0;padding:15px 18px;display:flex;align-items:center;justify-content:space-between;gap:22px;background:#142a34da;border:1px solid #f0e2c71c;border-radius:13px}.hint{font-size:14px;color:#cfdbd7;white-space:pre-wrap;overflow-wrap:anywhere}.page{font-size:20px;color:var(--accent);white-space:nowrap;font-family:Georgia,serif}.signature{margin:16px 0 0;text-align:center;font-size:10px;letter-spacing:4px;color:#c4d0c899}.empty{margin:0 0 20px;padding:28px;background:#142a34da;border-radius:16px;color:#dbe4de}
</style></head><body><main><header><div class="eyebrow">ZHIN / COMMAND ATLAS</div><h1>${escape(appearance.title || commandMessages(locale, 'guideTitle', { title }))}</h1><div class="subtitle">${escape(appearance.subtitle ?? commandMessages(locale, 'guideSubtitle'))}</div><div class="summary"><i></i>${escape(commandMessages(locale, 'commandCount', { count: options.commandTotal ?? commands.length }))}<span>·</span>${escape(commandMessages(locale, 'pluginCount', { count: options.pluginTotal ?? children.length }))}<span>·</span>${escape(title)}</div></header>
${section(commandMessages(locale, 'commandIndex'), commands, options.commandTotal ?? commands.length)}${section(commandMessages(locale, 'pluginIndex'), children, options.pluginTotal ?? children.length, true)}${commands.length || children.length ? '' : `<p class="empty">${commandMessages(locale, 'guideEmpty')}</p>`}
<footer><div class="hint">${escape(hint ?? commandMessages(locale, 'genericHelpHint'))}</div><div class="page">${String(page).padStart(2, '0')} / ${String(pages).padStart(2, '0')}</div></footer><div class="signature">ZHIN · MAKE EVERY MESSAGE MATTER</div></main></body></html>`,
    },
  };
}
