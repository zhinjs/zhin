/**
 * 轻量 HTML 模板工具（对标 satori-html 的「字符串 → HTML」部分，不引入额外依赖）。
 * 产出 HTML 字符串后交给本包的 htmlToSvg / 或 html-renderer.render。
 */

/** HTML 文本转义（用于用户数据插值） */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** escapeHtml 简写 */
export const e = escapeHtml;

/**
 * 标签模板：拼接静态片段与表达式（表达式原样插入，需自行 e() 转义用户文本）。
 * 也可作为函数：html('<div>...</div>')
 */
export function html(
  templates: TemplateStringsArray | string,
  ...expressions: unknown[]
): string {
  if (typeof templates === "string") return templates;
  let out = templates[0] ?? "";
  for (let i = 0; i < expressions.length; i++) {
    const v = expressions[i];
    out += v == null ? "" : String(v);
    out += templates[i + 1] ?? "";
  }
  return out;
}

/**
 * 标签模板：字符串/数字表达式自动转义；其它类型（如子模板拼接结果）原样插入。
 */
export function htmlSafe(
  templates: TemplateStringsArray,
  ...expressions: unknown[]
): string {
  let out = templates[0] ?? "";
  for (let i = 0; i < expressions.length; i++) {
    const v = expressions[i];
    if (typeof v === "string") out += escapeHtml(v);
    else if (typeof v === "number") out += v;
    else out += v == null ? "" : String(v);
    out += templates[i + 1] ?? "";
  }
  return out;
}

/** 压缩标签间空白，便于 Satori 解析 */
export function tightHtml(fragment: string): string {
  return fragment.trim().replace(/>\s+</g, "><");
}

/** 卡片画布外包一层 flex 列容器（与 html-renderer wrap 一致） */
export function wrapCardHtml(body: string, backgroundColor: string): string {
  return tightHtml(html`
    <div style="display:flex;flex-direction:column;width:100%;background-color:${backgroundColor};font-family:sans-serif">
      ${body}
    </div>
  `);
}
