interface MenuEntry {
  readonly name: string;
  readonly description?: string;
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

/** Presentation only: the unified outbound pipeline owns image rendering and fallback. */
export function renderCommandMenu(
  title: string,
  commands: readonly MenuEntry[],
  children: readonly MenuEntry[],
  hint: string | undefined,
  text: string,
): CommandMenuSegment {
  const escape = (value: string) => value.replace(/[&<>"']/gu, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
  const entries = (items: readonly MenuEntry[]) => items.map(item =>
    `<div class="entry"><div class="name">${escape(item.name)}</div>${item.description
      ? `<div class="description">${escape(item.description)}</div>` : ''}</div>`).join('');
  const section = (label: string, items: readonly MenuEntry[]) => items.length === 0 ? ''
    : `<section><h2>${label}<span>${items.length}</span></h2><div class="grid">${entries(items)}</div></section>`;

  return {
    type: 'html',
    data: {
      width: 860,
      fileName: 'command-menu.png',
      text,
      html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#edf1f8;color:#17233b;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:20px;line-height:1.5}
main{padding:32px;background:#fff;border:1px solid #dce3ef;border-radius:26px;box-shadow:0 12px 30px #253e6610}
header{padding:26px;background:linear-gradient(120deg,#172c53,#344f7c);border-radius:18px;color:#fff}
.eyebrow{font-size:13px;font-weight:700;letter-spacing:3px;color:#b7c9e8}h1{margin:10px 0;font-size:32px;line-height:1.35;overflow-wrap:anywhere}
.summary{color:#ccdaef;font-size:16px}section{margin:26px 0}h2{margin:0 0 14px;font-size:19px;display:flex;align-items:center}
h2 span{margin:0 10px;padding:1px 9px;border-radius:8px;background:#e9eff9;color:#49638e;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.entry{padding:16px;background:#f5f7fb;border:1px solid #e3e8f1;border-radius:14px;overflow-wrap:anywhere}
.name{font-size:19px;font-weight:600;color:#243f6b;white-space:pre-wrap}.description{margin:6px 0 0;color:#65738b;font-size:16px;white-space:pre-wrap}
footer{margin:26px 0 0;padding:16px;background:#edf3fc;border-radius:12px;color:#45608b;font-size:16px;overflow-wrap:anywhere;white-space:pre-wrap}.empty{margin:26px 0;color:#65738b}
</style></head><body><main><header><div class="eyebrow">ZHIN · COMMAND MENU</div><h1>${escape(title)} 指令菜单</h1><div class="summary">${commands.length} 条指令 · ${children.length} 个子插件</div></header>
${section('指令', commands)}${section('子插件', children)}${commands.length || children.length ? '' : '<p class="empty">暂无指令和子插件</p>'}
${hint ? `<footer>${escape(hint)}</footer>` : ''}</main></body></html>`,
    },
  };
}
