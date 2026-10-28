/**
 * 受控自我进化：试跑（ADR 0040 §3，切片 C1——静态检查）。
 *
 * 草稿起草后宿主自动试跑：`draft → trialing → ready | trial_failed`。本切片做 §3.1 静态检查：
 * - `syntax`：代码文件能被生产加载器解析。`.ts` / `.mts` / `.cts` / `.js` 走 Node 原生类型剥离
 *   （与生产加载 `.ts` 同一实现，`enum` 等 strip-only 不支持的语法同样算失败）；`.tsx` / `.jsx`
 *   由宿主注入的检查器（CLI 用 esbuild，与 tsx 加载器同源），未注入时记 `skipped`。
 * - `default_export`：约定目录的能力文件必须默认导出对应的 `defineXxx()`（形状的权威校验在沙箱加载）。
 * - `forbidden_import`：沿用 harness 检查——直调 `bot.$sendMessage`、直接 import `koa`、插件直连
 *   `@zhin.js/kernel`、已删除的 `zhin.js/node` / `bootstrapNode`。
 * - `skill` / `agent_manifest`：`SKILL.md` 能被 Skill 解析器接受，`agent.json` 是 JSON 对象。
 *
 * 静态检查全部在内存里完成，不写临时文件；结果写进 `change.json` 的 `trial`（每条消息截断，总量有界）。
 *
 * 切片 C2——§3.3 沙箱加载：静态检查通过后，按插件根把草稿交给宿主注入的 `sandboxLoad`（CLI 在一次性
 * 子进程里用只挂 IM 运行时、无适配器的试跑运行时装配草稿后的插件树），确认装配成功、草稿里的能力文件
 * 都被发现。未注入加载器时该阶段留在 `pendingStages`。
 *
 * 切片 C3——§3.2 插件自带测试：沙箱加载通过后，同一插件根交给宿主注入的 `pluginTests`（CLI 在 P0-c
 * 隔离容器里跑：项目依赖只读、草稿拷贝可写、无网络）。插件没有测试或本机没有隔离容器时记 `skipped`。
 * 未注入时该阶段留在 `pendingStages`。
 */
import { stripTypeScriptTypes } from 'node:module';
import { parseSkillMarkdown } from '@zhin.js/skill';
import { CHANGE_CONVENTION_DIRS, clipChangeError } from './policy.js';
import type { SelfChangeRecord, SelfChangeStore } from './store.js';

const TRIAL_VERSION = 1;
/** 单条检查消息上限（字符）。 */
const MAX_TRIAL_MESSAGE_CHARS = 300;

export type SelfChangeTrialCheckName =
  | 'syntax'
  | 'default_export'
  | 'forbidden_import'
  | 'skill'
  | 'agent_manifest'
  | 'sandbox_load'
  | 'capability_discovered'
  | 'plugin_tests';

export interface SelfChangeTrialCheck {
  readonly check: SelfChangeTrialCheckName;
  readonly path: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly message?: string;
}

export interface SelfChangeTrialResult {
  readonly version: typeof TRIAL_VERSION;
  readonly passed: boolean;
  /** 试跑所针对的内容摘要；审批时与 `content_hash` 对得上才算数。 */
  readonly contentHash: string;
  readonly checks: readonly SelfChangeTrialCheck[];
  /** 本次没有执行的试跑阶段（宿主未注入对应执行器的 `sandbox_load` / `plugin_tests`）。 */
  readonly pendingStages: readonly string[];
  readonly startedAt: number;
  readonly durationMs: number;
}

/** 返回错误消息；通过返回 `null`。 */
export type SelfChangeSyntaxCheck = (target: string, source: string) => string | null | Promise<string | null>;

/** 一个插件根上的沙箱加载请求；路径都相对项目根。 */
export interface SelfChangeSandboxLoadRequest {
  /** 插件根（相对项目根，`''` 为项目根本身）。 */
  readonly pluginRoot: string;
  /** 落到该插件根下的草稿写入（相对项目根）。 */
  readonly writes: readonly SelfChangeTrialFile[];
  /** 落到该插件根下的删除（相对项目根）。 */
  readonly deletes: readonly string[];
}

/** 试跑运行时装配出的一个能力；`source` 相对插件根。 */
export interface SelfChangeSandboxCapability {
  readonly feature: string;
  readonly localName: string;
  readonly source: string;
}

export interface SelfChangeSandboxLoadResult {
  /** `skipped`：宿主无法在本机做沙箱加载（例如插件根超出拷贝上限），原因写在 `message`。 */
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly message?: string;
  readonly capabilities?: readonly SelfChangeSandboxCapability[];
}

/** 宿主注入的沙箱加载器：必须在宿主进程之外执行草稿代码，且不连接任何真实平台、不调用模型。 */
export type SelfChangeSandboxLoader = (request: SelfChangeSandboxLoadRequest) => Promise<SelfChangeSandboxLoadResult>;

/** 插件自带测试的结果：`skipped` 表示插件没有测试或本机无法在隔离容器里跑，原因写在 `message`。 */
export interface SelfChangePluginTestResult {
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly message?: string;
}

/**
 * 宿主注入的插件测试执行器（§3.2）：必须在隔离容器里执行（项目只读、草稿拷贝可写、无网络），
 * 不能在宿主进程或宿主 shell 里跑草稿代码。请求与沙箱加载同形。
 */
export type SelfChangePluginTestRunner = (request: SelfChangeSandboxLoadRequest) => Promise<SelfChangePluginTestResult>;

export interface SelfChangeTrialOptions {
  /** `.tsx` / `.jsx` 的语法检查器（宿主注入）；缺省时这两类文件记 `skipped`。 */
  readonly jsxSyntax?: SelfChangeSyntaxCheck;
  /** §3.3 沙箱加载（宿主注入）；缺省时该阶段留在 `pendingStages`。 */
  readonly sandboxLoad?: SelfChangeSandboxLoader;
  /** §3.2 插件自带测试（宿主注入）；缺省时该阶段留在 `pendingStages`。 */
  readonly pluginTests?: SelfChangePluginTestRunner;
  /** 额外的本地插件根（相对项目根），与暂存区白名单同口径。 */
  readonly pluginRoots?: readonly string[];
  readonly now?: () => number;
}

export interface SelfChangeTrialFile {
  readonly path: string;
  readonly content: string;
}

const STRIP_EXTENSIONS = /\.(?:[cm]?ts|[cm]?js)$/iu;
const JSX_EXTENSIONS = /\.(?:tsx|jsx)$/iu;
const SKIPPED_CODE = /(?:\.d\.[cm]?ts|\.(?:test|spec)\.[cm]?[jt]sx?)$/iu;

/** 约定目录 → 能力文件必须默认导出的定义函数（CLAUDE.md 约定目录表）。 */
const DEFINE_BY_DIR: Readonly<Record<string, string>> = Object.freeze({
  commands: 'defineCommand',
  middlewares: 'defineMiddleware',
  handlers: 'defineHandler',
  components: 'defineComponent',
  tools: 'defineAgentTool',
});

interface ForbiddenRule {
  readonly id: string;
  readonly test: (source: string, specifiers: readonly string[]) => boolean;
  readonly message: string;
}

const FORBIDDEN_RULES: readonly ForbiddenRule[] = Object.freeze([
  {
    id: 'send_bypass',
    test: source => /\bbot\.\$sendMessage\s*\(/u.test(source),
    message: 'calls the endpoint $sendMessage directly; reply with message.$reply() or adapter.sendMessage() so the send chain applies',
  },
  {
    id: 'koa_import',
    test: (_source, specifiers) => specifiers.some(specifier => specifier === 'koa' || specifier.startsWith('koa/')),
    message: 'imports koa directly; use the Runtime Host HTTP API (RouterContext / registerFetchRoute)',
  },
  {
    id: 'kernel_import',
    test: (_source, specifiers) => specifiers.some(specifier => specifier === '@zhin.js/kernel' || specifier.startsWith('@zhin.js/kernel/')),
    message: 'imports @zhin.js/kernel; plugins go through zhin.js / @zhin.js/core',
  },
  {
    id: 'removed_api',
    test: (source, specifiers) => specifiers.includes('zhin.js/node') || /\bbootstrapNode\b/u.test(source),
    message: 'uses the removed zhin.js/node / bootstrapNode entry; use definePlugin() and convention directories',
  },
]);

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/gu;

/**
 * 对一组暂存文件跑静态检查（纯函数，除注入的检查器外不碰外部）。删除条目不在这里出现。
 */
export async function checkSelfChangeFiles(
  files: readonly SelfChangeTrialFile[],
  options: Pick<SelfChangeTrialOptions, 'jsxSyntax' | 'pluginRoots'> = {},
): Promise<readonly SelfChangeTrialCheck[]> {
  const checks: SelfChangeTrialCheck[] = [];
  const add = (check: SelfChangeTrialCheckName, target: string, status: SelfChangeTrialCheck['status'], message?: string) => {
    checks.push(Object.freeze({ check, path: target, status, ...(message ? { message: clipTrialMessage(message) } : {}) }));
  };
  for (const file of files) {
    const local = pluginLocalPath(file.path, options.pluginRoots ?? []);
    const segments = local.split('/');
    const base = segments.at(-1)!.toLowerCase();
    if (base === 'skill.md' && isSkillFile(segments)) {
      try {
        const dir = segments.slice(0, -1);
        parseSkillMarkdown(file.content, { owner: 'self-change' as never, feature: 'skill' as never, localName: dir.join('/'), source: file.path });
        add('skill', file.path, 'passed');
      } catch (error) {
        add('skill', file.path, 'failed', errorMessage(error));
      }
      continue;
    }
    if (base === 'agent.json' && segments[0] === 'agents' && segments.length === 3) {
      try {
        const parsed = JSON.parse(file.content) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('agent.json must be a JSON object');
        add('agent_manifest', file.path, 'passed');
      } catch (error) {
        add('agent_manifest', file.path, 'failed', errorMessage(error));
      }
      continue;
    }
    const strip = STRIP_EXTENSIONS.test(base);
    const jsx = JSX_EXTENSIONS.test(base);
    if (!strip && !jsx) continue;

    let syntaxOk = true;
    try {
      const failure = strip ? stripSyntaxError(file.content) : options.jsxSyntax ? await options.jsxSyntax(file.path, file.content) : undefined;
      if (failure === undefined) add('syntax', file.path, 'skipped', 'no JSX syntax checker on this host; the sandbox load checks it');
      else if (failure === null) add('syntax', file.path, 'passed');
      else {
        syntaxOk = false;
        add('syntax', file.path, 'failed', failure);
      }
    } catch (error) {
      syntaxOk = false;
      add('syntax', file.path, 'failed', errorMessage(error));
    }

    const source = stripComments(file.content);
    const specifiers = importSpecifiers(source);
    const violations = FORBIDDEN_RULES.filter(rule => rule.test(source, specifiers));
    if (violations.length) add('forbidden_import', file.path, 'failed', violations.map(rule => rule.message).join('; '));
    else add('forbidden_import', file.path, 'passed');

    const define = SKIPPED_CODE.test(base) ? undefined : expectedDefine(segments);
    if (define && syntaxOk) {
      if (!/\bexport\s+default\b/u.test(source)) add('default_export', file.path, 'failed', `must default-export ${define}(...)`);
      else if (!new RegExp(`\\b${define}\\s*[<(]`, 'u').test(source)) add('default_export', file.path, 'failed', `default export must be built with ${define}(...)`);
      else add('default_export', file.path, 'passed');
    }
  }
  return Object.freeze(checks);
}

/**
 * 试跑一个草稿：`draft → trialing`，读暂存内容跑检查，结果写进 `trial`，再进 `ready` 或
 * `trial_failed`（终态，立即瘦身）。检查器自身出错也算试跑失败，不会卡在 `trialing`。
 */
export async function runSelfChangeTrial(
  store: SelfChangeStore,
  id: string,
  options: SelfChangeTrialOptions & { readonly turnId?: string } = {},
): Promise<SelfChangeRecord> {
  const now = options.now ?? Date.now;
  const trialing = await store.transition(id, 'trialing', {
    actor: 'policy',
    reasonCode: 'change_drafted',
    auditPayload: { trial: 'started' },
    ...(options.turnId ? { turnId: options.turnId } : {}),
  });
  const startedAt = now();
  let checks: readonly SelfChangeTrialCheck[];
  let crash: string | null = null;
  try {
    const files: SelfChangeTrialFile[] = [];
    for (const entry of trialing.files) {
      if (entry.op !== 'write') continue;
      const content = await store.readStagedFile(id, entry.path);
      if (content === null) throw new Error(`staged content for ${entry.path} is missing`);
      files.push({ path: entry.path, content });
    }
    checks = await checkSelfChangeFiles(files, options);
    if (options.sandboxLoad && !checks.some(check => check.status === 'failed')) {
      const deletes = trialing.files.filter(entry => entry.op !== 'write').map(entry => entry.path);
      checks = Object.freeze([...checks, ...await sandboxLoadChecks(files, deletes, options.sandboxLoad, options.pluginRoots ?? [])]);
    }
    if (options.pluginTests && !checks.some(check => check.status === 'failed')) {
      const deletes = trialing.files.filter(entry => entry.op !== 'write').map(entry => entry.path);
      checks = Object.freeze([...checks, ...await pluginTestChecks(files, deletes, options.pluginTests, options.pluginRoots ?? [])]);
    }
  } catch (error) {
    checks = Object.freeze([]);
    crash = clipTrialMessage(`trial could not run: ${errorMessage(error)}`);
  }
  const failed = checks.filter(check => check.status === 'failed');
  const passed = crash === null && failed.length === 0;
  const trial: SelfChangeTrialResult = Object.freeze({
    version: TRIAL_VERSION,
    passed,
    contentHash: trialing.contentHash,
    checks,
    pendingStages: Object.freeze([
      ...(options.pluginTests ? [] : ['plugin_tests']),
      ...(options.sandboxLoad ? [] : ['sandbox_load']),
    ]),
    startedAt,
    durationMs: Math.max(0, now() - startedAt),
  });
  const turn = options.turnId ? { turnId: options.turnId } : {};
  if (passed) return store.transition(id, 'ready', { actor: 'policy', trial, ...turn });
  const error = crash ?? failed.map(check => `${check.path} [${check.check}]: ${check.message ?? 'failed'}`).join('\n');
  return store.transition(id, 'trial_failed', {
    actor: 'policy',
    trial,
    error,
    auditPayload: { failedChecks: failed.map(check => ({ path: check.path, check: check.check })) },
    ...turn,
  });
}

/**
 * §3.3：按插件根分组，交给宿主在试跑运行时里装配。只有改到约定目录（插件代码、Skill、Agent）的
 * 插件根才需要加载；只改根 `AGENTS.md` 的变更不加载。装配成功后，草稿里每个顶层约定目录的能力文件
 * 都必须被发现——没被发现的文件生效后也不会上线（例如 `commands/ping.ts` 应为 `commands/ping/index.ts`）。
 */
async function sandboxLoadChecks(
  writes: readonly SelfChangeTrialFile[],
  deletes: readonly string[],
  load: SelfChangeSandboxLoader,
  pluginRoots: readonly string[],
): Promise<readonly SelfChangeTrialCheck[]> {
  const checks: SelfChangeTrialCheck[] = [];
  for (const [pluginRoot, entry] of groupByPluginRoot(writes, deletes, pluginRoots)) {
    const label = pluginRoot || '.';
    let result: SelfChangeSandboxLoadResult;
    try {
      result = await load(Object.freeze({ pluginRoot, writes: Object.freeze(entry.writes), deletes: Object.freeze(entry.deletes) }));
    } catch (error) {
      result = { status: 'failed', message: `sandbox load could not run: ${errorMessage(error)}` };
    }
    checks.push(trialCheck('sandbox_load', label, result.status, result.message));
    if (result.status !== 'passed') continue;
    const sources = new Set((result.capabilities ?? []).map(capability => capability.source.replace(/\\/gu, '/')));
    const sourceDirs = new Set([...sources].map(source => source.slice(0, Math.max(0, source.lastIndexOf('/')))));
    for (const file of entry.writes) {
      const local = splitPluginRoot(file.path, pluginRoots).local;
      const segments = local.split('/');
      const base = segments.at(-1)!;
      if (!DEFINE_BY_DIR[segments[0]!] || SKIPPED_CODE.test(base) || !(STRIP_EXTENSIONS.test(base) || JSX_EXTENSIONS.test(base))) continue;
      if (sources.has(local)) {
        checks.push(trialCheck('capability_discovered', file.path, 'passed'));
        continue;
      }
      // 能力目录里与入口并排的辅助模块（`commands/ping/format.ts`）随入口加载，不单独成能力。
      const dir = segments.slice(0, -1).join('/');
      if (!/^index\.[cm]?[jt]sx?$/iu.test(base) && sourceDirs.has(dir)) continue;
      checks.push(trialCheck('capability_discovered', file.path, 'failed',
        `the trial runtime did not discover ${local} as a ${segments[0]} capability; check the convention layout (e.g. ${segments[0]}/<name>/index.ts) and that the plugin declares the feature`));
    }
  }
  return checks;
}

/**
 * §3.2：沙箱加载通过后，对改到约定目录的每个插件根跑一次插件自带测试。执行器自身出错按失败记
 * （不能借执行器崩溃绕过测试）。
 */
async function pluginTestChecks(
  writes: readonly SelfChangeTrialFile[],
  deletes: readonly string[],
  run: SelfChangePluginTestRunner,
  pluginRoots: readonly string[],
): Promise<readonly SelfChangeTrialCheck[]> {
  const checks: SelfChangeTrialCheck[] = [];
  for (const [pluginRoot, entry] of groupByPluginRoot(writes, deletes, pluginRoots)) {
    let result: SelfChangePluginTestResult;
    try {
      result = await run(Object.freeze({ pluginRoot, writes: Object.freeze(entry.writes), deletes: Object.freeze(entry.deletes) }));
    } catch (error) {
      result = { status: 'failed', message: `plugin tests could not run: ${errorMessage(error)}` };
    }
    checks.push(trialCheck('plugin_tests', pluginRoot || '.', result.status, result.message));
  }
  return checks;
}

/** 按插件根分组，只保留改到约定目录（插件代码、Skill、Agent）的根；按根路径排序。 */
function groupByPluginRoot(
  writes: readonly SelfChangeTrialFile[],
  deletes: readonly string[],
  pluginRoots: readonly string[],
): [string, { writes: SelfChangeTrialFile[]; deletes: string[] }][] {
  const groups = new Map<string, { writes: SelfChangeTrialFile[]; deletes: string[]; loads: boolean }>();
  const group = (target: string) => {
    const { root, local } = splitPluginRoot(target, pluginRoots);
    let entry = groups.get(root);
    if (!entry) groups.set(root, entry = { writes: [], deletes: [], loads: false });
    if (CHANGE_CONVENTION_DIRS.includes(local.split('/')[0]!.toLowerCase())) entry.loads = true;
    return entry;
  };
  for (const file of writes) group(file.path).writes.push(file);
  for (const target of deletes) group(target).deletes.push(target);
  return [...groups]
    .filter(([, entry]) => entry.loads)
    .sort(([left], [right]) => left.localeCompare(right));
}

function trialCheck(check: SelfChangeTrialCheckName, target: string, status: SelfChangeTrialCheck['status'], message?: string): SelfChangeTrialCheck {
  return Object.freeze({ check, path: target, status, ...(message ? { message: clipTrialMessage(message) } : {}) });
}

/** 拆出插件根（相对项目根，`''` 为项目根）与相对插件根的路径。 */
function splitPluginRoot(target: string, pluginRoots: readonly string[]): { readonly root: string; readonly local: string } {
  const folded = target.toLowerCase();
  for (const root of pluginRoots) {
    const prefix = root.replace(/\\/gu, '/').split('/').filter(segment => segment && segment !== '.').join('/');
    if (!prefix) continue;
    if (folded.startsWith(`${prefix.toLowerCase()}/`)) {
      const rest = target.slice(prefix.length + 1);
      if (CHANGE_CONVENTION_DIRS.includes(rest.split('/')[0]!.toLowerCase())) return { root: target.slice(0, prefix.length), local: rest };
    }
  }
  return { root: '', local: target };
}

/** 去掉插件根前缀，得到相对插件根的路径（项目根本身也是插件根）。 */
function pluginLocalPath(target: string, pluginRoots: readonly string[]): string {
  return splitPluginRoot(target, pluginRoots).local;
}

/** `skills/<n>/SKILL.md` 或 `agents/<a>/skills/<n>/SKILL.md`。 */
function isSkillFile(segments: readonly string[]): boolean {
  return (segments.length === 3 && segments[0] === 'skills')
    || (segments.length === 5 && segments[0] === 'agents' && segments[2] === 'skills');
}

/** 该路径应默认导出的定义函数；不是能力文件（辅助模块等）返回 `undefined`。 */
function expectedDefine(segments: readonly string[]): string | undefined {
  const dir = segments[0];
  if (!dir) return undefined;
  const define = DEFINE_BY_DIR[dir];
  // 指令只从 `commands/<name>/index.*` 加载；同目录的其他文件是随入口加载的辅助模块。
  if (dir === 'commands' && segments.length > 2 && !/^index\.[cm]?[jt]sx?$/iu.test(segments.at(-1)!)) return undefined;
  if (define) return define;
  // Skill / Agent 私有工具：`.../tools/<name>/index.ts`。
  const toolsAt = segments.lastIndexOf('tools');
  if ((dir === 'skills' || dir === 'agents') && toolsAt > 0 && segments.length === toolsAt + 3 && /^index\.[cm]?[jt]sx?$/iu.test(segments.at(-1)!)) {
    return DEFINE_BY_DIR.tools;
  }
  return undefined;
}

function stripSyntaxError(source: string): string | null {
  try {
    stripTypeScriptTypes(source, { mode: 'strip' });
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

/** 粗略去掉注释，避免注释里的示例代码触发规则（字符串里的 `//` 可能被误删，只用于规则匹配）。 */
function stripComments(source: string): string {
  // 块注释用线性扫描去掉（正则 `/\*[\s\S]*?\*\/` 在未闭合的 `/*` 上会回溯成多项式，CodeQL js/polynomial-redos）。
  let withoutBlocks = '';
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('/*', cursor);
    if (open < 0) break;
    const close = source.indexOf('*/', open + 2);
    // 未闭合的 `/*` 保持原样（与原正则一致），不能借此藏住后面的禁止导入。
    if (close < 0) break;
    withoutBlocks += `${source.slice(cursor, open)} `;
    cursor = close + 2;
  }
  withoutBlocks += source.slice(cursor);
  return withoutBlocks.replace(/(^|[^:'"`\\])\/\/[^\n]*/gu, '$1');
}

function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) out.push(match[2]!);
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clipTrialMessage(message: string): string {
  const clipped = clipChangeError(message);
  return clipped.length > MAX_TRIAL_MESSAGE_CHARS ? `${clipped.slice(0, MAX_TRIAL_MESSAGE_CHARS - 1)}…` : clipped;
}
