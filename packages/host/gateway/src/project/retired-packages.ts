/**
 * `@zhin.js/*` packages that were merged into another package, renamed or removed, and package
 * subpaths that were deleted (#1250 `retired-package-not-flagged`). Their last releases stay on the
 * registry and keep depending on old Zhin releases: a project that still declares one installs a
 * second copy of `@zhin.js/runtime` / `@zhin.js/plugin-runtime` and fails the single-instance
 * check, which no `pnpm.overrides` entry fixes for good. `zhin doctor` and `zhin migrate` read this
 * catalog to name the replacement and tell the user to drop the dependency.
 *
 * Each entry is backed by the repository history (the commit or changelog that merged, renamed or
 * deleted the package). Where the history names no successor, the entry says so instead of
 * guessing one. `docs/migrations/retired-packages.md` holds the same table for readers.
 */

/** Where `zhin doctor` / `zhin migrate` send readers for the full table. */
export const RETIRED_PACKAGES_DOCS_URL = 'https://zhin.js.org/migrations/retired-packages';

/** One import rewrite: `from` is the retired specifier, `to` the replacement specifier. */
export interface RetiredPackageImport {
  readonly from: string;
  readonly to: string;
  /** Exports that moved, for messages (e.g. `YamlConfigDocument`). Empty: everything moved. */
  readonly symbols: readonly string[];
  /** Exports that moved under another name (old name → new name). */
  readonly renamed?: Readonly<Record<string, string>>;
  /**
   * Subpath exports of the retired package (`x` for `from/x`) that live on as `to/x`. Absent: the
   * package exported only `.`, so an import of `from/x` gets no replacement, only the action.
   */
  readonly subpaths?: readonly string[];
}

export interface RetiredZhinPackage {
  readonly name: string;
  /**
   * `merged`: the code lives on in `replacement`; `renamed`: published as `replacement` from then
   * on; `removed`: deleted (`replacement`, when set, is the package that took over its role).
   */
  readonly status: 'merged' | 'renamed' | 'removed';
  /** The package to depend on instead (absent when nothing replaces it). */
  readonly replacement?: string;
  /** Import rewrites, only where the exports carried over unchanged. */
  readonly imports: readonly RetiredPackageImport[];
  /** What to do, as one Chinese sentence (shown by doctor and migrate). */
  readonly action: string;
}

/** A subpath export that was deleted from a package that is still published. */
export interface RemovedZhinSubpath {
  /** The deleted specifier, e.g. `@zhin.js/agent/tools`. */
  readonly specifier: string;
  /** The package that still exists (`@zhin.js/agent`). */
  readonly package: string;
  /** The specifier to import from instead. */
  readonly replacement: string;
  /** Exports that moved to `replacement`. */
  readonly symbols: readonly string[];
  /** What to do, as one Chinese sentence (shown by doctor and migrate). */
  readonly action: string;
}

/** Action of a package whose history names no successor. */
function noDirectReplacement(name: string): string {
  return `已停更，无直接替代（参见迁移文档 ${RETIRED_PACKAGES_DOCS_URL}）：确认项目不再使用它后删除 ${name} 依赖`;
}

/** Retired `@zhin.js/*` packages, sorted by name. */
export const RETIRED_ZHIN_PACKAGES: readonly RetiredZhinPackage[] = Object.freeze([
  {
    // 9bf2bf4dc8: plugins/adapters/process → plugins/adapters/sandbox, renamed @zhin.js/adapter-sandbox.
    name: '@zhin.js/adapter-process',
    status: 'renamed',
    replacement: '@zhin.js/adapter-sandbox',
    imports: [],
    action: '已改名为 @zhin.js/adapter-sandbox：改为依赖 @zhin.js/adapter-sandbox（按它的文档调整插件配置），然后删除 @zhin.js/adapter-process 依赖',
  },
  {
    name: '@zhin.js/ai-provider',
    status: 'merged',
    replacement: '@zhin.js/ai',
    imports: [{ from: '@zhin.js/ai-provider', to: '@zhin.js/ai/provider', symbols: [] }],
    action: '已并入 @zhin.js/ai：把 import 从 @zhin.js/ai-provider 改成 @zhin.js/ai/provider，然后删除 @zhin.js/ai-provider 依赖',
  },
  {
    name: '@zhin.js/config-file',
    status: 'merged',
    replacement: '@zhin.js/runtime',
    imports: [{ from: '@zhin.js/config-file', to: '@zhin.js/runtime', symbols: ['YamlConfigDocument', 'JsonConfigDocument', 'createConfigDocument'] }],
    action: '已并入 @zhin.js/runtime：把 import 从 @zhin.js/config-file 改成 @zhin.js/runtime（或 @zhin.js/runtime/config-file），然后删除 @zhin.js/config-file 依赖',
  },
  {
    // 3d42fc9be0 (refactor(config): unify file transactions): YamlConfigDocument moved into
    // @zhin.js/runtime; its error base class became the format-independent ConfigFileDocumentError.
    name: '@zhin.js/config-yaml',
    status: 'merged',
    replacement: '@zhin.js/runtime',
    imports: [{
      from: '@zhin.js/config-yaml',
      to: '@zhin.js/runtime',
      symbols: ['YamlConfigDocument', 'ConfigDocumentParseError', 'ConfigDocumentConflictError'],
      renamed: { YamlConfigDocumentError: 'ConfigFileDocumentError' },
    }],
    action: '已停更并入 @zhin.js/runtime：改用 @zhin.js/runtime 的 YamlConfigDocument（import { YamlConfigDocument } from \'@zhin.js/runtime\'）；'
      + 'YamlConfigDocumentError 改名为 ConfigFileDocumentError，ConfigDocumentParseError、ConfigDocumentConflictError 改为继承 ConfigFileDocumentError'
      + '（instanceof YamlConfigDocumentError 的判断改成 instanceof ConfigFileDocumentError；ConfigDocumentParseError 的构造参数多了 format），然后删除 @zhin.js/config-yaml 依赖',
  },
  {
    // 90d9efd682: plugins/services/console became @zhin.js/host-api, deleted in 3e925d0e9d.
    name: '@zhin.js/console',
    status: 'removed',
    imports: [],
    action: '已删除（先改名为 @zhin.js/host-api，后者也已删除）：zhin start 自动装配 Console 与 HTTP Host；删除 @zhin.js/console 依赖及其插件配置',
  },
  {
    // 940ae2007a: the Console UI left the monorepo; only the Host API stayed.
    name: '@zhin.js/console-app',
    status: 'removed',
    imports: [],
    action: '已删除（Console 前端已移出本仓库）：zhin start 自动装配 Console；删除 @zhin.js/console-app 依赖',
  },
  {
    // 90d9efd682: packages/console-core → packages/console/pagemanager; its browser half
    // (loadConsoleEntries, apiFetch, …) moved to @zhin.js/client in 940ae2007a.
    name: '@zhin.js/console-core',
    status: 'renamed',
    replacement: '@zhin.js/pagemanager',
    imports: [],
    action: '已改名为 @zhin.js/pagemanager（浏览器端的 loadConsoleEntries、apiFetch 等已移到 @zhin.js/client）：改用 @zhin.js/pagemanager 后删除 @zhin.js/console-core 依赖',
  },
  {
    // 90d9efd682: packages/console-types/src moved into packages/console/contract.
    name: '@zhin.js/console-types',
    status: 'merged',
    replacement: '@zhin.js/contract',
    imports: [],
    action: '已并入 @zhin.js/contract：改从 @zhin.js/contract 导入（导出名以它的当前版本为准），然后删除 @zhin.js/console-types 依赖',
  },
  { name: '@zhin.js/dependency', status: 'removed', imports: [], action: noDirectReplacement('@zhin.js/dependency') },
  { name: '@zhin.js/devteam', status: 'removed', imports: [], action: noDirectReplacement('@zhin.js/devteam') },
  {
    // cc5c94dd72: plugins/games/shared → packages/game-kit, renamed @zhin.js/game-kit.
    name: '@zhin.js/game-shared',
    status: 'renamed',
    replacement: '@zhin.js/game-kit',
    imports: [],
    action: '已改名为 @zhin.js/game-kit：改为依赖 @zhin.js/game-kit 并按它的当前导出改写 import，然后删除 @zhin.js/game-shared 依赖',
  },
  { name: '@zhin.js/hmr', status: 'removed', imports: [], action: noDirectReplacement('@zhin.js/hmr') },
  {
    name: '@zhin.js/host-api',
    status: 'removed',
    imports: [],
    action: '已删除：zhin start 自动装配 Console 与 HTTP Host，不再需要 Host 插件；删除 @zhin.js/host-api 依赖及其插件配置',
  },
  {
    name: '@zhin.js/host-router',
    status: 'removed',
    imports: [],
    action: '已删除：HTTP 服务由 zhin start 装配的 @zhin.js/host-http 提供；删除 @zhin.js/host-router 依赖及其插件配置',
  },
  {
    // 90d9efd682: plugins/services/http became @zhin.js/host-router, deleted in 3e925d0e9d.
    name: '@zhin.js/http',
    status: 'removed',
    imports: [],
    action: '已删除（先改名为 @zhin.js/host-router，后者也已删除）：HTTP 服务由 zhin start 装配的 @zhin.js/host-http 提供；删除 @zhin.js/http 依赖及其插件配置',
  },
  {
    // 90d9efd682: split into @zhin.js/host-router and @zhin.js/host-api, both deleted in 3e925d0e9d.
    name: '@zhin.js/http-host',
    status: 'removed',
    imports: [],
    action: '已删除（拆进 @zhin.js/host-router 与 @zhin.js/host-api，两者也已删除）：HTTP 服务由 zhin start 装配的 @zhin.js/host-http 提供；删除 @zhin.js/http-host 依赖',
  },
  {
    name: '@zhin.js/interaction',
    status: 'merged',
    replacement: '@zhin.js/im-contract',
    imports: [{ from: '@zhin.js/interaction', to: '@zhin.js/im-contract/interaction', symbols: [] }],
    action: '已并入 @zhin.js/im-contract：把 import 从 @zhin.js/interaction 改成 @zhin.js/im-contract/interaction，然后删除 @zhin.js/interaction 依赖',
  },
  {
    name: '@zhin.js/isolate',
    status: 'merged',
    replacement: '@zhin.js/runtime',
    imports: [{ from: '@zhin.js/isolate', to: '@zhin.js/runtime/isolate', symbols: [] }],
    action: '已并入 @zhin.js/runtime：把 import 从 @zhin.js/isolate 改成 @zhin.js/runtime/isolate，然后删除 @zhin.js/isolate 依赖',
  },
  {
    // 6d94111b9a: plugins/services/github-notify → plugins/adapters/github (@zhin.js/adapter-github).
    name: '@zhin.js/plugin-github-notify',
    status: 'renamed',
    replacement: '@zhin.js/adapter-github',
    imports: [],
    action: '已改为 GitHub 适配器 @zhin.js/adapter-github（Webhook 通知是它的一部分）：改为依赖 @zhin.js/adapter-github 并按它的文档配置，然后删除 @zhin.js/plugin-github-notify 依赖',
  },
  {
    // 20519bbfa5: capabilities live in @zhin.js/html-renderer.
    name: '@zhin.js/plugin-html-renderer',
    status: 'removed',
    replacement: '@zhin.js/html-renderer',
    imports: [],
    action: '已删除，HTML 渲染由 @zhin.js/html-renderer 提供：改为依赖 @zhin.js/html-renderer，然后删除 @zhin.js/plugin-html-renderer 依赖及其插件配置',
  },
  {
    // bff0adbd54: renamed @zhin.js/testing; API and the PluginTestKit class name unchanged.
    name: '@zhin.js/plugin-test-kit',
    status: 'renamed',
    replacement: '@zhin.js/testing',
    imports: [{ from: '@zhin.js/plugin-test-kit', to: '@zhin.js/testing', symbols: [] }],
    action: '已改名为 @zhin.js/testing（API 与 PluginTestKit 不变）：把 import 从 @zhin.js/plugin-test-kit 改成 @zhin.js/testing，然后删除 @zhin.js/plugin-test-kit 依赖',
  },
  {
    // c4575c954e / 20519bbfa5: speech (STT / TTS) moved to @zhin.js/speech, config key speech:.
    name: '@zhin.js/plugin-voice',
    status: 'removed',
    replacement: '@zhin.js/speech',
    imports: [],
    action: '已删除，语音能力由 @zhin.js/speech 提供：改为依赖 @zhin.js/speech，配置键 voice: 改为 speech:，然后删除 @zhin.js/plugin-voice 依赖',
  },
  { name: '@zhin.js/queue-runtime', status: 'removed', imports: [], action: noDirectReplacement('@zhin.js/queue-runtime') },
  {
    // 4308350e68: raster rendering consolidated on @pixel.js/shotium in @zhin.js/html-renderer; the
    // Satori image toolkit was removed.
    name: '@zhin.js/satori',
    status: 'removed',
    replacement: '@zhin.js/html-renderer',
    imports: [],
    action: '已删除，栅格渲染统一由 @zhin.js/html-renderer 提供：改用 @zhin.js/html-renderer，然后删除 @zhin.js/satori 依赖',
  },
  {
    // 20519bbfa5: replaced by the content-moderation hooks of @zhin.js/plugin-content-moderation
    // (see that plugin's README).
    name: '@zhin.js/sensitive-filter',
    status: 'removed',
    replacement: '@zhin.js/plugin-content-moderation',
    imports: [],
    action: '已删除，内容过滤由 @zhin.js/plugin-content-moderation 提供：改为依赖并配置 @zhin.js/plugin-content-moderation，然后删除 @zhin.js/sensitive-filter 依赖及其插件配置',
  },
  { name: '@zhin.js/storage-port', status: 'removed', imports: [], action: noDirectReplacement('@zhin.js/storage-port') },
  { name: '@zhin.js/types', status: 'removed', imports: [], action: noDirectReplacement('@zhin.js/types') },
  {
    name: '@zhin.js/workroom',
    status: 'removed',
    imports: [],
    action: '已删除：多 Bot 共享的群或频道改在 ai.venues 声明，协作范围写在 agents/<name>/agent.json 的 collaboration；删除 @zhin.js/workroom 依赖',
  },
] satisfies RetiredZhinPackage[]);

/** Deleted subpath exports of packages that are still published, sorted by specifier. */
export const REMOVED_ZHIN_SUBPATHS: readonly RemovedZhinSubpath[] = Object.freeze([
  {
    // 33ea736407 (refactor(tool): unify agent tool authoring): the duplicate @zhin.js/agent/tools
    // definition and export were removed; defineAgentTool lives in @zhin.js/tool.
    specifier: '@zhin.js/agent/tools',
    package: '@zhin.js/agent',
    replacement: '@zhin.js/tool',
    symbols: ['defineAgentTool'],
    action: '子路径 @zhin.js/agent/tools 已删除：defineAgentTool 改从 @zhin.js/tool 导入（工具放在 tools/<name>/index.ts）；'
      + 'toolApprovalAlways / toolApprovalOnce / toolApprovalNever 改成 defineAgentTool 的 requiresApproval: \'always\' | \'once\' | \'never\'',
  },
] satisfies RemovedZhinSubpath[]);

const BY_NAME = new Map(RETIRED_ZHIN_PACKAGES.map(entry => [entry.name, entry]));

/** The catalog entry for `name`, or undefined when the package is current. */
export function findRetiredZhinPackage(name: string): RetiredZhinPackage | undefined {
  return BY_NAME.get(name);
}

/** The deleted subpath `specifier` is (or lies under), or undefined when it is current. */
export function findRemovedZhinSubpath(specifier: string): RemovedZhinSubpath | undefined {
  return REMOVED_ZHIN_SUBPATHS.find(entry => specifier === entry.specifier || specifier.startsWith(`${entry.specifier}/`));
}

/** Dependency fields a project declares packages in (checked for retired packages). */
const DECLARING_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

export interface RetiredDependency {
  readonly name: string;
  /** The package.json field that declares it. */
  readonly field: typeof DECLARING_FIELDS[number];
  readonly specifier: string;
  readonly retired: RetiredZhinPackage;
}

/** Retired packages a manifest (`package.json` content) declares directly, in catalog order. */
export function findRetiredDependencies(manifest: unknown): RetiredDependency[] {
  if (!manifest || typeof manifest !== 'object') return [];
  const found: RetiredDependency[] = [];
  for (const field of DECLARING_FIELDS) {
    const deps = (manifest as Record<string, unknown>)[field];
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
    for (const [name, specifier] of Object.entries(deps)) {
      const retired = BY_NAME.get(name);
      if (retired) found.push({ name, field, specifier: String(specifier), retired });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.field.localeCompare(b.field));
}

export interface RetiredImportUse {
  /** 1-based line of the specifier. */
  readonly line: number;
  /** The specifier as written (`@zhin.js/isolate`, `@zhin.js/agent/tools`). */
  readonly specifier: string;
  /** What to do (the catalog entry's action). */
  readonly action: string;
  /** The retired package imported (absent for a deleted subpath of a current package). */
  readonly retired?: RetiredZhinPackage;
  /** The deleted subpath imported (absent for a retired package). */
  readonly removedSubpath?: RemovedZhinSubpath;
  /**
   * The specifier to import instead, only where it exists: the package root of a retired package
   * with an import rewrite (or one of its listed subpaths), or a deleted subpath itself.
   */
  readonly replacement?: string;
}

const ZHIN_SPECIFIER = /^(@zhin\.js\/[a-z0-9-]+)((?:\/[^\s'"`]*)?)$/u;

function isIdentifierChar(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
    || code === 0x24 || code === 0x5f || code > 0x7f;
}

function classify(specifier: string, line: number): RetiredImportUse | undefined {
  const removed = findRemovedZhinSubpath(specifier);
  if (removed) {
    return { line, specifier, action: removed.action, removedSubpath: removed, ...(specifier === removed.specifier ? { replacement: removed.replacement } : {}) };
  }
  const match = ZHIN_SPECIFIER.exec(specifier);
  if (!match) return undefined;
  const [, name, subpath] = match as unknown as [string, string, string];
  const retired = BY_NAME.get(name);
  if (!retired) return undefined;
  const rule = retired.imports.find(entry => entry.from === name);
  const sub = subpath.slice(1);
  const replacement = !rule ? undefined
    : sub === '' ? rule.to
      : rule.subpaths?.includes(sub) ? `${rule.to}/${sub}` : undefined;
  return { line, specifier, action: retired.action, retired, ...(replacement ? { replacement } : {}) };
}

/**
 * Module specifiers of retired packages and deleted subpaths in one source text. A single linear
 * pass skips `//` line comments and `/* *\/` block comments and reads each string literal whole,
 * so a specifier inside a comment or inside another string is not reported. A literal counts when
 * it directly follows `from`, `import` or `import(` / `require(` (whitespace and comments between
 * them are allowed); a template literal counts only without `${`. A `/` where an expression starts
 * (at the start of the text, or after an operator, `(`, `,`, `=`, `:`, `[`, `{`, `}`, `;` or a
 * keyword such as `return` / `typeof`) is read as a regular expression literal up to its closing
 * `/` (escapes and `[...]` character classes included), so a quote, backtick or `/*` inside one
 * does not start a string or comment. After an identifier, a literal, `)` or `]` a `/` is division
 * (JavaScript reads `a` + newline + `/b/` as division too, so the line start alone decides
 * nothing). A regular expression literal never spans lines: one that is not closed on its line is
 * read as division, and no further `/` on that line is read as one (this keeps the pass linear).
 * Remaining limit: JSX text is read as code, so a quote or backtick in it (`<p>Don't</p>`) starts
 * a string — a quote one ends at the line end, a backtick one runs to the next backtick and can
 * hide or invent matches over several lines. Nothing is rewritten: `zhin migrate` lists these as
 * the edits to make by hand.
 */
export function findRetiredImports(source: string): RetiredImportUse[] {
  const uses: RetiredImportUse[] = [];
  const length = source.length;
  let line = 1;
  // The last two significant tokens before the current position: identifiers by name, other
  // punctuation as the character itself, string literals as `''`.
  let previous = '';
  let beforePrevious = '';
  const push = (token: string): void => { beforePrevious = previous; previous = token; };
  const takesSpecifier = (): boolean => previous === 'from' || previous === 'import'
    || (previous === '(' && (beforePrevious === 'import' || beforePrevious === 'require'));
  // Set when a `/` read as a regular expression was not closed on its line: up to that line's end
  // no `/` is read as one again.
  let regexOffUntil = 0;
  let i = 0;
  while (i < length) {
    const code = source.charCodeAt(i);
    if (code === 0x0a) { line += 1; i += 1; continue; }
    if (code === 0x20 || code === 0x09 || code === 0x0d) { i += 1; continue; }
    if (code === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
      const end = source.indexOf('\n', i + 2);
      i = end === -1 ? length : end;
      continue;
    }
    if (code === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? length : end + 2;
      for (let j = i + 2; j < stop; j += 1) if (source.charCodeAt(j) === 0x0a) line += 1;
      i = stop;
      continue;
    }
    if (code === 0x2f && i >= regexOffUntil && startsExpression(previous)) {
      const end = regexLiteralEnd(source, i);
      if (end !== undefined) {
        push('/re/');
        i = end;
        continue;
      }
      // Not closed on this line: division, and no other `/` on this line starts a literal.
      const newline = source.indexOf('\n', i);
      regexOffUntil = newline === -1 ? length : newline;
    }
    if (code === 0x27 || code === 0x22 || code === 0x60) {
      const startLine = line;
      const quote = code;
      let j = i + 1;
      let interpolated = false;
      while (j < length) {
        const c = source.charCodeAt(j);
        if (c === 0x5c) {
          if (source.charCodeAt(j + 1) === 0x0a) line += 1;
          j += 2;
          continue;
        }
        if (c === quote) break;
        if (c === 0x0a) {
          if (quote !== 0x60) break; // an unterminated '…' / "…" ends at the line end
          line += 1;
        }
        if (quote === 0x60 && c === 0x24 && source.charCodeAt(j + 1) === 0x7b) interpolated = true;
        j += 1;
      }
      const text = source.slice(i + 1, Math.min(j, length));
      if (takesSpecifier() && !interpolated && text.startsWith('@zhin.js/') && !text.includes('\\')) {
        const use = classify(text, startLine);
        if (use) uses.push(use);
      }
      push("''");
      i = j < length && source.charCodeAt(j) === quote ? j + 1 : j;
      continue;
    }
    if (isIdentifierChar(code)) {
      let j = i + 1;
      while (j < length && isIdentifierChar(source.charCodeAt(j))) j += 1;
      // A property access (`x.import`, `obj.from`) is not the keyword.
      push(beforeDot(source, i) ? '.name' : source.slice(i, j));
      i = j;
      continue;
    }
    push(source[i]!);
    i += 1;
  }
  return uses;
}

/** Keywords after which a `/` starts a regular expression literal, not a division. */
const REGEX_AFTER_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);

/** Punctuation after which a `/` starts a regular expression literal. */
const REGEX_AFTER_PUNCTUATION = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '/']);

/** Whether a `/` after the significant token `previous` starts an expression (a regular expression literal). */
function startsExpression(previous: string): boolean {
  return previous === '' || REGEX_AFTER_PUNCTUATION.has(previous) || REGEX_AFTER_KEYWORDS.has(previous);
}

/**
 * The index just past the regular expression literal whose opening `/` is at `start` (flags
 * included), or undefined when no closing `/` follows on the same line.
 */
function regexLiteralEnd(source: string, start: number): number | undefined {
  const length = source.length;
  let inClass = false;
  let j = start + 1;
  while (j < length) {
    const c = source.charCodeAt(j);
    if (c === 0x0a || c === 0x0d) return undefined;
    if (c === 0x5c) {
      const next = source.charCodeAt(j + 1);
      if (next === 0x0a || next === 0x0d) return undefined;
      j += 2;
      continue;
    }
    if (inClass) {
      if (c === 0x5d) inClass = false;
    } else if (c === 0x5b) {
      inClass = true;
    } else if (c === 0x2f) {
      j += 1;
      while (j < length && isIdentifierChar(source.charCodeAt(j))) j += 1;
      return j;
    }
    j += 1;
  }
  return undefined;
}

/** Whether the identifier starting at `index` is a property name (`.` right before it, spaces allowed). */
function beforeDot(source: string, index: number): boolean {
  let k = index - 1;
  while (k >= 0 && (source.charCodeAt(k) === 0x20 || source.charCodeAt(k) === 0x09)) k -= 1;
  return k >= 0 && source.charCodeAt(k) === 0x2e && source.charCodeAt(k - 1) !== 0x2e;
}
