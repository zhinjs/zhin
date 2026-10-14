/**
 * 抹掉注释与模板字符串内容（替换为空格、保留换行），
 * 使后续正则不会匹配到注释里或代码生成模板（如 packages/host/mcp
 * handlers.ts 生成插件源码的模板字符串）里的 "import ... from" 文本。
 * 普通字符串保留原样（模块说明符本身就在字符串里）。
 * @param {string} content
 * @returns {string}
 */
export function maskCommentsAndTemplates(content) {
  const out = content.split('');
  // 状态栈：'code' | 'line' | 'block' | 'squote' | 'dquote' | 'template'
  // template 内的 ${ ... } 以括号深度回到 code 处理（支持嵌套模板）。
  const stack = [{ mode: 'code', braceDepth: 0 }];
  const top = () => stack[stack.length - 1];
  const mask = (i) => { if (out[i] !== '\n') out[i] = ' '; };

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    const st = top();

    if (st.mode === 'line') {
      mask(i);
      if (ch === '\n') stack.pop();
      continue;
    }
    if (st.mode === 'block') {
      mask(i);
      if (ch === '*' && next === '/') { mask(i + 1); i++; stack.pop(); }
      continue;
    }
    if (st.mode === 'squote' || st.mode === 'dquote') {
      if (ch === '\\') { i++; continue; }
      if ((st.mode === 'squote' && ch === "'") || (st.mode === 'dquote' && ch === '"')) stack.pop();
      continue;
    }
    if (st.mode === 'template') {
      if (ch === '\\') { mask(i); mask(i + 1); i++; continue; }
      if (ch === '`') { mask(i); stack.pop(); continue; }
      if (ch === '$' && next === '{') {
        mask(i); mask(i + 1); i++;
        stack.push({ mode: 'code', braceDepth: 0 });
        continue;
      }
      mask(i);
      continue;
    }

    // code 模式
    if (ch === '/' && next === '/') { mask(i); mask(i + 1); i++; stack.push({ mode: 'line' }); continue; }
    if (ch === '/' && next === '*') { mask(i); mask(i + 1); i++; stack.push({ mode: 'block' }); continue; }
    if (ch === "'") { stack.push({ mode: 'squote' }); continue; }
    if (ch === '"') { stack.push({ mode: 'dquote' }); continue; }
    if (ch === '`') { mask(i); stack.push({ mode: 'template' }); continue; }
    if (ch === '{') { st.braceDepth++; continue; }
    if (ch === '}' && stack.length > 1) {
      if (st.braceDepth === 0) stack.pop(); // ${ } 结束，回到 template
      else st.braceDepth--;
    }
  }
  return out.join('');
}

const STR = `['"]([^'"]+)['"]`;

/**
 * 解析导入语句（忽略注释和模板字符串中的导入）。
 * 覆盖：单行/多行静态 import、bare import（import 'x'）、
 * export ... from '...' 再导出（含 export * as ns）、动态 import('...')、require('...')。
 * 默认跳过纯类型导入（import type / export type）；includeTypeOnly 时一并返回。
 * @param {string} content - 文件内容
 * @param {{ includeTypeOnly?: boolean }} [options]
 * @returns {string[]} - 导入的包名列表
 */
export function parseImports(content, { includeTypeOnly = false } = {}) {
  const imports = [];
  const masked = maskCommentsAndTemplates(content);

  const patterns = includeTypeOnly
    ? [
      new RegExp(`(?<![\\w$.])import\\s+(?:type\\s+)?[\\s\\S]*?\\bfrom\\s*${STR}`, 'g'),
      new RegExp(`(?<![\\w$.])import\\s*${STR}`, 'g'),
      new RegExp(`(?<![\\w$.])export\\s+(?:type\\s+)?(?:\\*(?:\\s+as\\s+[\\w$]+)?|\\{[\\s\\S]*?\\})\\s*\\bfrom\\s*${STR}`, 'g'),
      new RegExp(`(?<![\\w$.])import\\s*\\(\\s*${STR}\\s*\\)`, 'g'),
      new RegExp(`require\\s*\\(\\s*${STR}\\s*\\)`, 'g'),
    ]
    : [
      // 静态 import（含多行 import 块与 bare import），跳过 import type
      /(?<![\w$.])import\s+(?!type\s)[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
      /(?<![\w$.])import\s*['"]([^'"]+)['"]/g,
      // export { ... } from / export * from / export * as ns from（含多行），跳过 export type
      /(?<![\w$.])export\s+(?!type\s)(?:\*(?:\s+as\s+[\w$]+)?|\{[\s\S]*?\})\s*\bfrom\s*['"]([^'"]+)['"]/g,
      // 动态 import('...')（含 import('x').Type 内联类型；相对路径本就放行）
      /(?<![\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      // require('...')
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(masked)) !== null) {
      imports.push(match[1]);
    }
  }

  return imports;
}

/**
 * 仅返回 `export ... from '...'` 再导出的说明符（含 export type / export * / export type *）。
 * @param {string} content
 * @returns {string[]}
 */
export function parseReexports(content) {
  const masked = maskCommentsAndTemplates(content);
  const out = [];
  const patterns = [
    new RegExp(`(?<![\\w$.])export\\s+(?:type\\s+)?(?:\\*(?:\\s+as\\s+[\\w$]+)?|\\{[^}]*\\})\\s*from\\s*${STR}`, 'g'),
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(masked)) !== null) out.push(match[1]);
  }
  return out;
}

/**
 * Barrel 只能 `export ... from` 指向受限目录：返回其余形式（import / import() / require 等）
 * 引用到 `isRestricted(specifier)` 的说明符（按多重集合扣除再导出）。
 * @param {string} content
 * @param {(specifier: string) => boolean} isRestricted
 * @returns {string[]}
 */
export function findBarrelViolations(content, isRestricted) {
  const remaining = new Map();
  for (const spec of parseReexports(content)) remaining.set(spec, (remaining.get(spec) ?? 0) + 1);
  const violations = [];
  for (const spec of parseImports(content, { includeTypeOnly: true })) {
    if (!isRestricted(spec)) continue;
    const left = remaining.get(spec) ?? 0;
    if (left > 0) remaining.set(spec, left - 1);
    else violations.push(spec);
  }
  return violations;
}
