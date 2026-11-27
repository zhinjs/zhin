/**
 * Page UI checks of `zhin plugin check` (ADR 0063 决策 4 / D20): rules 1–6 over a plugin's `pages/**`.
 *
 * For third-party plugins every finding is a hint: it never counts as an error or a warning, so it
 * does not block `zhin plugin check --strict`, a build or `zhin pub`. The official plugins of
 * zhinjs/zhin treat the same findings as errors in CI (`pnpm check:plugin`, gate list
 * `scripts/plugin-ui-gate.json`). A finding is waived only by an inline comment that names the rule
 * and a reason (see {@link IGNORE_DIRECTIVE}); there is no per-plugin or per-file switch.
 *
 * Only Node built-ins and the optional `typescript` peer are used (the repository gate imports this
 * file straight from source).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export type PageUiRuleId = 1 | 2 | 3 | 4 | 5 | 6;

export interface PageUiRule {
  readonly id: PageUiRuleId;
  readonly key: string;
  readonly title: string;
  /** Why the pattern is a problem. */
  readonly meaning: string;
  /** How to align it with `@zhin.js/console-ui`. */
  readonly fix: string;
}

export const PAGE_UI_RULES: readonly PageUiRule[] = Object.freeze([
  {
    id: 1,
    key: 'native-select',
    title: '原生 <select>',
    meaning: '原生下拉的弹出层、触控尺寸和深浅色与 Console 不一致，窄屏下也不会变成底部抽屉',
    fix: '换成 @zhin.js/console-ui 的 Select（选项多、需要搜索时用 SearchableSelect）',
  },
  {
    id: 2,
    key: 'custom-page-header',
    title: '自定义页头',
    meaning: '页头（标题、说明、操作）由 Console 的页面外壳渲染，页面自己再写一个会重复或与外壳不一致',
    fix: '标题写在 definePage({ title })，页头操作交给 @zhin.js/console-ui 的 usePageChrome()；页内小节从 <h2> 起，或用 Card 的标题',
  },
  {
    id: 3,
    key: 'fixed-width',
    title: '固定内容宽度',
    meaning: '内容宽度由外壳按页面类型决定（阅读 / 表单页与数据页两种），页面根容器写死宽度会在宽屏留白、在窄屏溢出',
    fix: '删掉固定宽度，交给外壳；需要占满宽度时用 definePage({ fullWidth: true })',
  },
  {
    id: 4,
    key: 'raw-style-value',
    title: '原始样式数值',
    meaning: '字号、字重、圆角、阴影、内外边距、间隔写了字面值，不跟随 Console 的尺度，换设备或 Console 调整令牌时会和周围不一致',
    fix: '改用 @zhin.js/console-ui 的组件，或改用第二层语义令牌 var(--console-…)（见 @zhin.js/console-ui 的 tokens.css）',
  },
  {
    id: 5,
    key: 'off-scale-tailwind',
    title: '尺度外的 Tailwind 类名',
    meaning: '任意值（p-[…]、rounded-[…]、text-[…]）、尺度外的间距键（如 p-7、gap-2.5）或 Tailwind 默认的 shadow-* 不在 Console 的尺度内',
    fix: '改用生成主题中的档位（间距键 1、2、3、4、5、6、8、10、12、16；圆角 0–7 / full / pill；阴影 e1–e3），或改用组件',
  },
  {
    id: 6,
    key: 'native-control',
    title: '非组件库的基础控件',
    meaning: '原生控件没有 Console 的触控尺寸、焦点环、深浅色和窄容器下的布局切换，需要插件自己保证硬性底线',
    fix: '换成 @zhin.js/console-ui 的 Button、Input、Textarea、Table、Dialog',
  },
] satisfies PageUiRule[]);

const RULE_BY_ID = new Map(PAGE_UI_RULES.map((rule) => [rule.id, rule]));

export function pageUiRule(id: PageUiRuleId): PageUiRule {
  return RULE_BY_ID.get(id)!;
}

export interface PageUiFinding {
  readonly rule: PageUiRuleId;
  /** Plugin-relative posix path. */
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  /** What was found, e.g. `<select>` or `padding: 12px`. */
  readonly detail: string;
}

/** An inline `zhin-ui-ignore` comment (static rules 1–6). */
export interface PageUiExemption {
  readonly rules: readonly PageUiRuleId[];
  readonly reason: string;
  readonly file: string;
  /** Line of the comment. */
  readonly line: number;
  /** Line it waives. */
  readonly target: number;
  /** Findings it waived. */
  readonly waived: readonly PageUiFinding[];
}

/** A `data-zhin-ui-ignore` attribute: a waiver for one check of the Playwright layout audit. */
export interface PageUiAuditExemption {
  readonly check: string;
  readonly reason: string;
  readonly file: string;
  readonly line: number;
}

export interface PageUiDirectiveProblem {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface PageUiReport {
  /** Page source files that were checked. */
  readonly files: number;
  /** Findings not waived by an exemption. */
  readonly findings: readonly PageUiFinding[];
  readonly exemptions: readonly PageUiExemption[];
  readonly auditExemptions: readonly PageUiAuditExemption[];
  /** Malformed or unused ignore comments / attributes. */
  readonly directiveProblems: readonly PageUiDirectiveProblem[];
  /** Set when script sources could not be parsed (no `typescript`); CSS files are still checked. */
  readonly skipped?: string;
}

/**
 * Inline ignore comment: `zhin-ui-ignore <rules>: <reason>` in a `//`, `/* *\/` or `{/* *\/}` comment.
 * `<rules>` is one rule number or several separated by commas (`4,6`). A comment after code waives
 * its own line; a comment on a line of its own waives the next line with code.
 */
export const IGNORE_DIRECTIVE = 'zhin-ui-ignore';
/** JSX attribute that waives one Playwright audit check for an element and its descendants. */
export const AUDIT_IGNORE_ATTRIBUTE = 'data-zhin-ui-ignore';

const SCRIPT_EXTENSIONS = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const STYLE_EXTENSIONS = /\.(?:css|scss|less)$/u;
const SKIPPED_FILES = /\.d\.[cm]?ts$|\.(?:test|spec)\.[cm]?[jt]sx?$/u;

// ---------------------------------------------------------------------------------------------
// Value rules shared by CSS text and style objects
// ---------------------------------------------------------------------------------------------

/** CSS properties whose literal values rule 4 reports (kebab-case). */
const RAW_STYLE_PROPERTY = new RegExp(
  '^(?:font|font-size|font-weight|box-shadow|gap|row-gap|column-gap'
  + '|border-radius|border-(?:top|bottom|start|end)-(?:left|right|start|end)-radius'
  + '|(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?)$',
  'u',
);
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const STYLE_VALUE_KEYWORDS = new Set([...CSS_WIDE_KEYWORDS, 'none', 'auto', 'normal', 'calc', 'min', 'max', 'clamp']);

/** Removes `var(--console-…)` references (fallbacks included). */
function stripConsoleVariables(value: string): string {
  let out = '';
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf('var(', index);
    if (start < 0) {
      out += value.slice(index);
      break;
    }
    out += value.slice(index, start);
    let depth = 0;
    let end = start + 3;
    for (; end < value.length; end += 1) {
      if (value[end] === '(') depth += 1;
      else if (value[end] === ')' && --depth === 0) break;
    }
    const reference = value.slice(start, end + 1);
    out += /^var\(\s*--console-/u.test(reference) ? ' ' : reference;
    index = end + 1;
  }
  return out;
}

/** Whether a CSS value for a rule-4 property is a literal rather than `0`, a keyword or a Console token. */
export function isRawStyleValue(value: string): boolean {
  const input = value.replace(/!important\s*$/u, '');
  const rest = stripConsoleVariables(input);
  // `calc(var(--console-…) * 2)` scales a token: unitless factors next to a token are fine.
  const scalesToken = rest !== input;
  const tokens = rest.split(/[\s,()/*+]+/u).filter((token) => token !== '' && token !== '-');
  return tokens.some((token) => token !== '0' && !STYLE_VALUE_KEYWORDS.has(token.toLowerCase())
    && !(scalesToken && /^-?\d+(?:\.\d+)?$/u.test(token)));
}

const PX_CONTENT_WIDTH = 640;
const REM_CONTENT_WIDTH = 40;

/** Whether a width value fixes a content width (≥ 640px or ≥ 40rem / 40em). */
export function isFixedContentWidth(value: string): boolean {
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(px|rem|em)\b/gu)) {
    const amount = Number(match[1]);
    if (match[2] === 'px' ? amount >= PX_CONTENT_WIDTH : amount >= REM_CONTENT_WIDTH) return true;
  }
  return false;
}

function camelToKebab(name: string): string {
  return name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

const CSS_DECLARATION = /(?<![\w-])(-{2}console-content-max|[a-z]+(?:-[a-z]+)*)\s*:\s*([^;{}\n]+)/gu;

/** Rules 3 and 4 over CSS text (a stylesheet, or a string of CSS-in-JS). */
function checkCssText(text: string, lineOf: (offset: number) => number, push: (rule: PageUiRuleId, line: number, detail: string) => void): void {
  for (const match of text.matchAll(CSS_DECLARATION)) {
    const property = match[1]!.toLowerCase();
    const value = match[2]!.replace(/["'`]+\s*$/u, '').trim();
    if (value === '' || value.startsWith('//')) continue;
    const line = lineOf(match.index!);
    if (property === '--console-content-max') {
      push(3, line, `${property}: ${value}`);
    } else if ((property === 'width' || property === 'max-width') && isFixedContentWidth(value)) {
      push(3, line, `${property}: ${value}`);
    } else if (RAW_STYLE_PROPERTY.test(property) && isRawStyleValue(value)) {
      push(4, line, `${property}: ${value}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Tailwind class names (rule 5, and the content-width part of rule 3)
// ---------------------------------------------------------------------------------------------

const VARIANTS = '(?:[a-z0-9@*[\\]&=_-]+:)*!?';
const SPACING_UTILITY = '(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|scroll-[mp][xytrblse]?)';
const STYLE_UTILITY = `(?:${SPACING_UTILITY}|rounded(?:-(?:[trblse]|tl|tr|br|bl|ss|se|es|ee))?|text|font|shadow|leading|tracking|border(?:-[xytrblse])?)`;
const ARBITRARY_STYLE_CLASS = new RegExp(`^${VARIANTS}-?${STYLE_UTILITY}-(\\[[^\\]]+\\]|\\([^)]+\\))!?$`, 'u');
const SPACING_CLASS = new RegExp(`^${VARIANTS}-?${SPACING_UTILITY}-(\\d+(?:\\.\\d+)?)!?$`, 'u');
const DEFAULT_SHADOW_CLASS = new RegExp(`^${VARIANTS}shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|inner))?!?$`, 'u');
const WIDTH_ARBITRARY_CLASS = new RegExp(`^${VARIANTS}(?:max-)?w-\\[([^\\]]+)\\]!?$`, 'u');
const WIDTH_NAMED_CLASS = new RegExp(`^${VARIANTS}max-w-(?:[2-7]xl|prose|screen-[a-z0-9]+)!?$`, 'u');
// The 4px grid of @zhin.js/console-ui (ADR 0063 D36): 5 (20px) and 10 (40px) joined in 1.3.
const SPACING_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16']);

/** The rule a single class name breaks, if any. */
export function classNameRule(token: string): PageUiRuleId | undefined {
  const arbitrary = ARBITRARY_STYLE_CLASS.exec(token);
  if (arbitrary) {
    // `p-[var(--console-…)]` / `p-(--console-…)` reference a Console token and are fine.
    return /^[[(](?:var\()?--console-/u.test(arbitrary[1]!) ? undefined : 5;
  }
  const spacing = SPACING_CLASS.exec(token);
  if (spacing) return SPACING_KEYS.has(spacing[1]!) ? undefined : 5;
  if (DEFAULT_SHADOW_CLASS.test(token)) return 5;
  const width = WIDTH_ARBITRARY_CLASS.exec(token);
  if (width) return isFixedContentWidth(width[1]!) ? 3 : undefined;
  if (WIDTH_NAMED_CLASS.test(token)) return 3;
  return undefined;
}

function checkClassNames(text: string, lineOf: (offset: number) => number, push: (rule: PageUiRuleId, line: number, detail: string) => void): void {
  for (const match of text.matchAll(/\S+/gu)) {
    const rule = classNameRule(match[0]);
    if (rule !== undefined) push(rule, lineOf(match.index!), match[0]);
  }
}

// ---------------------------------------------------------------------------------------------
// Ignore directives
// ---------------------------------------------------------------------------------------------

interface ParsedDirective {
  readonly line: number;
  readonly target: number;
  readonly rules?: readonly PageUiRuleId[];
  readonly reason?: string;
  readonly problem?: string;
}

const DIRECTIVE_PATTERN = new RegExp(`(?:\\/\\/|\\/\\*)\\s*${IGNORE_DIRECTIVE}\\b(.*)$`, 'u');

function parseDirectives(lines: readonly string[]): ParsedDirective[] {
  const directives: ParsedDirective[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]!;
    const match = DIRECTIVE_PATTERN.exec(text);
    if (!match) continue;
    const before = text.slice(0, match.index).replace(/\{\s*$/u, '').trim();
    let target = index + 1;
    if (before === '') {
      target = 0;
      for (let next = index + 1; next < lines.length; next += 1) {
        const candidate = lines[next]!.trim();
        if (candidate !== '' && !DIRECTIVE_PATTERN.test(candidate)) {
          target = next + 1;
          break;
        }
      }
    }
    const body = match[1]!.replace(/\*\/\s*\}?\s*$/u, '').trim();
    const parsed = /^(\d+(?:\s*,\s*\d+)*)\s*[:：]\s*(.*)$/u.exec(body);
    if (!parsed) {
      directives.push({ line: index + 1, target, problem: `${IGNORE_DIRECTIVE} 写法应为「${IGNORE_DIRECTIVE} <检查项>: <理由>」，例如「${IGNORE_DIRECTIVE} 6: 画布内的原生 <button>，焦点和触控尺寸已自行满足底线」` });
      continue;
    }
    const numbers = parsed[1]!.split(',').map((item) => Number(item.trim()));
    const invalid = numbers.filter((number) => !RULE_BY_ID.has(number as PageUiRuleId));
    if (invalid.length > 0) {
      directives.push({ line: index + 1, target, problem: `${IGNORE_DIRECTIVE} 只能豁免第 1–6 条，不认识：${invalid.join(', ')}` });
      continue;
    }
    const reason = parsed[2]!.trim();
    if (reason === '') {
      directives.push({ line: index + 1, target, problem: `${IGNORE_DIRECTIVE} 缺少理由（写在检查项后的冒号之后）` });
      continue;
    }
    if (target === 0) {
      directives.push({ line: index + 1, target, problem: `${IGNORE_DIRECTIVE} 之后没有可豁免的代码行` });
      continue;
    }
    directives.push({ line: index + 1, target, rules: [...new Set(numbers)] as PageUiRuleId[], reason });
  }
  return directives;
}

// ---------------------------------------------------------------------------------------------
// Script sources (TypeScript compiler API)
// ---------------------------------------------------------------------------------------------

type TypeScriptApi = typeof import('typescript');

function loadTypeScript(pluginDirectory: string): TypeScriptApi | undefined {
  for (const base of [path.join(pluginDirectory, 'package.json'), import.meta.url]) {
    try {
      const typescript = createRequire(base)('typescript') as TypeScriptApi;
      if (typeof typescript.createSourceFile === 'function') return typescript;
    } catch {
      // try the next location
    }
  }
  return undefined;
}

const SELECT_TAG = new Set(['select']);
const HEADER_TAG = new Set(['h1']);
const NATIVE_CONTROL_TAGS = new Set(['button', 'input', 'textarea', 'table', 'dialog']);
/** Removed in ADR 0063 P4 (`@zhin.js/client` 1.4.0); its PageHeader / PluginPage still count as a custom header. */
const LEGACY_UI_MODULE = '@zhin.js/client/ui';
const LEGACY_UI_REMOVED = '（该子路径已在 @zhin.js/client 1.4.0 删除）';
const LEGACY_HEADER_EXPORTS = new Set(['PageHeader', 'PluginPage']);
const STYLE_CONTAINER_NAME = /(?:^|[a-z_])(?:style|styles|sx|css)$/iu;

function tagRule(tag: string): PageUiRuleId | undefined {
  if (SELECT_TAG.has(tag)) return 1;
  if (HEADER_TAG.has(tag)) return 2;
  if (NATIVE_CONTROL_TAGS.has(tag)) return 6;
  return undefined;
}

function scriptKind(ts: TypeScriptApi, file: string) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/u.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

interface SourceScan {
  push(rule: PageUiRuleId, line: number, detail: string): void;
  audit(check: string, reason: string, line: number): void;
  problem(line: number, message: string): void;
}

function checkScript(ts: TypeScriptApi, file: string, text: string, scan: SourceScan): void {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
  const lineAt = (position: number) => source.getLineAndCharacterOfPosition(position).line + 1;
  const nodeLine = (node: import('typescript').Node) => lineAt(node.getStart(source));
  /** Line of an offset inside a literal that starts at `start` (its opening quote). */
  const literalLine = (start: number) => (offset: number) => lineAt(start + 1 + offset);
  const namespaces = new Set<string>();

  const checkStyleProperty = (property: import('typescript').PropertyAssignment, inStyleAttribute: boolean) => {
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
    if (name === undefined) return;
    const cssName = name.startsWith('--') ? name : camelToKebab(name);
    const initializer = property.initializer;
    let value: string | undefined;
    if (ts.isNumericLiteral(initializer)) value = initializer.text === '0' ? '0' : `${initializer.text}px`;
    else if (ts.isPrefixUnaryExpression(initializer) && ts.isNumericLiteral(initializer.operand)) value = `-${initializer.operand.text}px`;
    else if (ts.isStringLiteralLike(initializer)) value = initializer.text;
    if (cssName === '--console-content-max') {
      scan.push(3, nodeLine(property), `${name}: ${initializer.getText(source)}`);
      return;
    }
    if (value === undefined) return;
    const detail = `${name}: ${initializer.getText(source)}`;
    if (inStyleAttribute && (cssName === 'width' || cssName === 'max-width') && isFixedContentWidth(value)) {
      scan.push(3, nodeLine(property), detail);
    } else if (RAW_STYLE_PROPERTY.test(cssName)) {
      const fontWeightNumber = cssName === 'font-weight' && ts.isNumericLiteral(initializer);
      if (fontWeightNumber || isRawStyleValue(value)) scan.push(4, nodeLine(property), detail);
    }
  };

  const checkStyleObject = (object: import('typescript').ObjectLiteralExpression, inStyleAttribute: boolean) => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      if (ts.isObjectLiteralExpression(property.initializer)) checkStyleObject(property.initializer, inStyleAttribute);
      else checkStyleProperty(property, inStyleAttribute);
    }
  };

  const checkTag = (tagName: import('typescript').JsxTagNameExpression, node: import('typescript').Node) => {
    if (ts.isIdentifier(tagName)) {
      const rule = tagRule(tagName.text);
      if (rule !== undefined) scan.push(rule, nodeLine(node), `<${tagName.text}>`);
    } else if (ts.isPropertyAccessExpression(tagName) && ts.isIdentifier(tagName.expression)
      && namespaces.has(tagName.expression.text) && LEGACY_HEADER_EXPORTS.has(tagName.name.text)) {
      scan.push(2, nodeLine(node), `<${tagName.getText(source)}>（${LEGACY_UI_MODULE}）${LEGACY_UI_REMOVED}`);
    }
  };

  const checkAttributes = (attributes: import('typescript').JsxAttributes) => {
    for (const attribute of attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      const name = attribute.name.getText(source);
      const initializer = attribute.initializer;
      if (name === 'style' && initializer && ts.isJsxExpression(initializer)
        && initializer.expression && ts.isObjectLiteralExpression(initializer.expression)) {
        checkStyleObject(initializer.expression, true);
      } else if (name === AUDIT_IGNORE_ATTRIBUTE) {
        const value = initializer && ts.isStringLiteral(initializer) ? initializer.text
          : initializer && ts.isJsxExpression(initializer) && initializer.expression && ts.isStringLiteralLike(initializer.expression)
            ? initializer.expression.text : undefined;
        const parsed = value === undefined ? undefined : /^\s*([a-z][a-z0-9-]*)\s*[:：]\s*(\S.*)$/u.exec(value);
        if (parsed) scan.audit(parsed[1]!, parsed[2]!.trim(), nodeLine(attribute));
        else scan.problem(nodeLine(attribute), `${AUDIT_IGNORE_ATTRIBUTE} 应写成字符串「<审计检查项>: <理由>」`);
      }
    }
  };

  const visit = (node: import('typescript').Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === LEGACY_UI_MODULE) {
      const clause = node.importClause;
      if (clause && !clause.isTypeOnly && clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          namespaces.add(clause.namedBindings.name.text);
        } else {
          for (const element of clause.namedBindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            if (!element.isTypeOnly && LEGACY_HEADER_EXPORTS.has(imported)) {
              scan.push(2, nodeLine(element), `import { ${imported} } from '${LEGACY_UI_MODULE}'${LEGACY_UI_REMOVED}`);
            }
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === LEGACY_UI_MODULE
      && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const exported = (element.propertyName ?? element.name).text;
        if (!element.isTypeOnly && LEGACY_HEADER_EXPORTS.has(exported)) {
          scan.push(2, nodeLine(element), `export { ${exported} } from '${LEGACY_UI_MODULE}'${LEGACY_UI_REMOVED}`);
        }
      }
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      checkTag(node.tagName, node);
      checkAttributes(node.attributes);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isCreateElement = (ts.isIdentifier(callee) && callee.text === 'createElement')
        || (ts.isPropertyAccessExpression(callee) && callee.name.text === 'createElement');
      const [first] = node.arguments;
      if (isCreateElement && first && ts.isStringLiteralLike(first)) {
        const rule = tagRule(first.text);
        if (rule !== undefined) scan.push(rule, nodeLine(node), `createElement('${first.text}')`);
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      const parent = node.parent;
      const containerName = parent && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent))
        && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) ? parent.name.text : undefined;
      const inStyleAttribute = Boolean(parent && ts.isJsxExpression(parent));
      if (!inStyleAttribute && containerName !== undefined && STYLE_CONTAINER_NAME.test(containerName)) {
        checkStyleObject(node, false);
        return;
      }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) {
        const start = node.getStart(source);
        checkClassNames(node.text, literalLine(start), scan.push);
        checkCssText(node.text, literalLine(start), scan.push);
      }
    } else if (ts.isTemplateExpression(node)) {
      for (const part of [node.head, ...node.templateSpans.map((span) => span.literal)]) {
        const start = part.getStart(source);
        checkClassNames(part.text, literalLine(start), scan.push);
        checkCssText(part.text, literalLine(start), scan.push);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

// ---------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------

export interface PageSourceResult {
  readonly findings: readonly PageUiFinding[];
  readonly exemptions: readonly PageUiExemption[];
  readonly auditExemptions: readonly PageUiAuditExemption[];
  readonly directiveProblems: readonly PageUiDirectiveProblem[];
  /** False when the file is a script and `typescript` was not available. */
  readonly checked: boolean;
}

/** Checks one page source file. `file` is the plugin-relative path used in the results. */
export function checkPageSource(file: string, text: string, typescript?: TypeScriptApi): PageSourceResult {
  const raw: PageUiFinding[] = [];
  const auditExemptions: PageUiAuditExemption[] = [];
  const directiveProblems: PageUiDirectiveProblem[] = [];
  const seen = new Set<string>();
  const scan: SourceScan = {
    push: (rule, line, detail) => {
      const key = `${rule}:${line}:${detail}`;
      if (seen.has(key)) return;
      seen.add(key);
      raw.push({ rule, file, line, detail: detail.length > 120 ? `${detail.slice(0, 117)}...` : detail });
    },
    audit: (check, reason, line) => auditExemptions.push({ check, reason, file, line }),
    problem: (line, message) => directiveProblems.push({ file, line, message }),
  };
  let checked = true;
  if (STYLE_EXTENSIONS.test(file)) {
    const lineStarts = [0];
    for (let index = 0; index < text.length; index += 1) if (text[index] === '\n') lineStarts.push(index + 1);
    const lineOf = (offset: number) => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (lineStarts[middle]! <= offset) low = middle;
        else high = middle - 1;
      }
      return low + 1;
    };
    checkCssText(text.replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, ' ')), lineOf, scan.push);
  } else if (typescript) {
    checkScript(typescript, file, text, scan);
  } else {
    checked = false;
  }

  const lines = text.split(/\r?\n/u);
  const exemptions: PageUiExemption[] = [];
  const waivedFindings = new Set<PageUiFinding>();
  for (const directive of parseDirectives(lines)) {
    if (directive.problem !== undefined) {
      directiveProblems.push({ file, line: directive.line, message: directive.problem });
      continue;
    }
    const waived = raw.filter((finding) => finding.line === directive.target && directive.rules!.includes(finding.rule));
    for (const finding of waived) waivedFindings.add(finding);
    exemptions.push({ rules: directive.rules!, reason: directive.reason!, file, line: directive.line, target: directive.target, waived });
    if (checked && waived.length === 0) {
      directiveProblems.push({ file, line: directive.line, message: `${IGNORE_DIRECTIVE} ${directive.rules!.join(',')} 没有豁免任何违规（第 ${directive.target} 行没有对应的发现），请删除` });
    }
  }
  return {
    findings: raw.filter((finding) => !waivedFindings.has(finding)),
    exemptions,
    auditExemptions,
    directiveProblems,
    checked,
  };
}

function listPageFiles(directory: string, prefix: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listPageFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

/** Page sources of a plugin: `pages/**` scripts and stylesheets, without tests, declarations and generated `.js` siblings. */
export function listPageSources(pluginDirectory: string): string[] {
  const files = listPageFiles(path.join(pluginDirectory, 'pages'), 'pages');
  const present = new Set(files);
  return files.filter((file) => {
    if (SKIPPED_FILES.test(file)) return false;
    if (STYLE_EXTENSIONS.test(file)) return true;
    if (!SCRIPT_EXTENSIONS.test(file)) return false;
    // prepack writes `foo.js` next to `foo.ts(x)`; check the source only.
    if (/\.js$/u.test(file)) return !['.ts', '.tsx'].some((extension) => present.has(file.replace(/\.js$/u, extension)));
    return true;
  });
}

/** Runs rules 1–6 over a plugin's `pages/**`. */
export function checkPluginPageUi(pluginDirectory: string): PageUiReport {
  const files = listPageSources(pluginDirectory);
  const typescript = files.some((file) => SCRIPT_EXTENSIONS.test(file)) ? loadTypeScript(pluginDirectory) : undefined;
  const findings: PageUiFinding[] = [];
  const exemptions: PageUiExemption[] = [];
  const auditExemptions: PageUiAuditExemption[] = [];
  const directiveProblems: PageUiDirectiveProblem[] = [];
  let unchecked = 0;
  for (const file of files) {
    const result = checkPageSource(file, fs.readFileSync(path.join(pluginDirectory, file), 'utf8'), typescript);
    findings.push(...result.findings);
    exemptions.push(...result.exemptions);
    auditExemptions.push(...result.auditExemptions);
    directiveProblems.push(...result.directiveProblems);
    if (!result.checked) unchecked += 1;
  }
  return {
    files: files.length,
    findings,
    exemptions,
    auditExemptions,
    directiveProblems,
    ...(unchecked > 0 ? { skipped: `未找到 typescript，跳过了 ${unchecked} 个页面脚本（只检查了样式文件）；在插件中安装 typescript 后重试` } : {}),
  };
}

export function formatPageUiFinding(finding: PageUiFinding): string {
  return `第 ${finding.rule} 条 ${pageUiRule(finding.rule).title}：${finding.file}:${finding.line} ${finding.detail}`;
}

/** Report lines for `zhin plugin check` (hints only). */
export function formatPageUiReport(report: PageUiReport): string[] {
  const lines: string[] = [];
  if (report.files === 0) return lines;
  lines.push('  页面 UI（ADR 0063 第 1–6 条，只提示，不影响构建与发布）');
  if (report.skipped) lines.push(`    ! ${report.skipped}`);
  if (report.findings.length === 0 && report.directiveProblems.length === 0) lines.push('    ✓ 未发现偏离');
  for (const finding of report.findings) lines.push(`    · ${formatPageUiFinding(finding)}`);
  for (const problem of report.directiveProblems) lines.push(`    · ${problem.file}:${problem.line} ${problem.message}`);
  const rules = [...new Set(report.findings.map((finding) => finding.rule))].sort();
  for (const id of rules) {
    const rule = pageUiRule(id);
    lines.push(`    第 ${id} 条（${rule.title}）：${rule.meaning}。建议：${rule.fix}`);
  }
  if (rules.length > 0) {
    lines.push(`    确实需要保留时，在该行写「// ${IGNORE_DIRECTIVE} <检查项>: <理由>」（JSX 中写 {/* ... */}）`);
  }
  for (const exemption of report.exemptions) {
    lines.push(`    豁免 第 ${exemption.rules.join(',')} 条：${exemption.file}:${exemption.line} ${exemption.reason}`);
  }
  return lines;
}
