import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import {
  CONVENTION_FEATURE_PACKAGES,
  featureApiRange,
  resolveStackRange,
} from './new-plugin-manifest.js';
import { toCapitalizedName } from './new.js';
import { installCommand } from './install.js';

/**
 * `zhin add <kind> <name>`: write one convention-directory capability file into the current plugin
 * package and declare the Feature package it needs in `package.json#zhin.features`
 * (docs/authoring/conventions.md). Templates are the smallest default export of the authoring API.
 */
export const ADD_KINDS = ['command', 'middleware', 'handler', 'tool', 'component'] as const;
export type AddKind = (typeof ADD_KINDS)[number];

export function isAddKind(value: string): value is AddKind {
  return (ADD_KINDS as readonly string[]).includes(value);
}

interface KindSpec {
  /** Convention directory; also the key of {@link CONVENTION_FEATURE_PACKAGES}. */
  readonly directory: string;
  readonly file: 'index.ts' | 'index.tsx';
  /** `commands/` and `handlers/` nest (`gh/issue`, `message/receive`); the others take one name. */
  readonly nested: boolean;
}

const KIND_SPECS: Readonly<Record<AddKind, KindSpec>> = {
  command: { directory: 'commands', file: 'index.ts', nested: true },
  middleware: { directory: 'middlewares', file: 'index.ts', nested: false },
  handler: { directory: 'handlers', file: 'index.ts', nested: true },
  tool: { directory: 'tools', file: 'index.ts', nested: false },
  component: { directory: 'components', file: 'index.tsx', nested: false },
};

const SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/;
const COMMAND_PARAMETER_PATTERN = /^\[([a-z][a-z0-9-]*)\]$/;
const EVENT_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
/** Core canonical events: their single argument is an `EndpointEvent` with a `payload`. */
const CANONICAL_HANDLER_EVENTS = new Set([
  'message.receive', 'notice.receive', 'request.receive', 'system.receive', 'platform.receive',
]);

/** A user error: printed without a stack, exit code 1. */
export class AddConventionError extends Error {}

export interface AddConventionOptions {
  readonly kind: string;
  readonly name: string;
  /** Directory to start the plugin package lookup from (default `process.cwd()`). */
  readonly cwd?: string;
  readonly force?: boolean;
  /** Handler event; defaults to the path joined with `.` when that is a canonical event. */
  readonly event?: string;
}

export interface AddConventionResult {
  readonly pluginDirectory: string;
  /** Package-relative (posix) path of the written file. */
  readonly file: string;
  readonly overwritten: boolean;
  /** Human-readable `package.json` changes; empty when everything was already declared. */
  readonly manifestChanges: readonly string[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isKind(kind: string): kind is AddKind {
  return (ADD_KINDS as readonly string[]).includes(kind);
}

/**
 * The plugin package is the nearest directory with a package.json. Lookup stops at the first
 * package.json, so a nested non-plugin package never writes into an enclosing bot project.
 */
export function findPluginPackage(start: string): { directory: string; manifest: JsonObject; raw: string } {
  let current = path.resolve(start);
  for (;;) {
    const manifestPath = path.join(current, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      let manifest: unknown;
      try {
        manifest = JSON.parse(raw);
      } catch (error) {
        throw new AddConventionError(`${manifestPath} 无法解析：${error instanceof Error ? error.message : String(error)}`);
      }
      if (!isObject(manifest) || !isObject(manifest.zhin) || manifest.zhin.type !== 'plugin') {
        throw new AddConventionError(
          `${manifestPath} 不是插件包（缺少 zhin.type: "plugin" 清单）；请在插件目录运行，或用 --cwd 指定插件目录（创建插件：zhin new <name>）`,
        );
      }
      return { directory: current, manifest, raw };
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new AddConventionError(`${path.resolve(start)} 及其上级目录没有 package.json；请在插件目录运行，或用 --cwd 指定插件目录`);
    }
    current = parent;
  }
}

/** Validated path segments; a command may end in one `[param]` segment. */
export function parseConventionName(kind: AddKind, name: string): { segments: string[]; parameter?: string } {
  const spec = KIND_SPECS[kind];
  const segments = name.replace(/^\/+|\/+$/g, '').split('/');
  const hint = '每段需匹配 /^[a-z][a-z0-9-]*$/（小写字母开头，仅小写字母、数字、横线）';
  if (segments.length === 0 || segments.some((segment) => segment === '')) {
    throw new AddConventionError(`无效的名称 ${JSON.stringify(name)}：${hint}`);
  }
  if (!spec.nested && segments.length > 1) {
    throw new AddConventionError(`${kind} 名称不能包含 /（${spec.directory}/<name>/${spec.file}）：${JSON.stringify(name)}`);
  }
  let parameter: string | undefined;
  for (const [index, segment] of segments.entries()) {
    if (SEGMENT_PATTERN.test(segment)) continue;
    const match = kind === 'command' ? COMMAND_PARAMETER_PATTERN.exec(segment) : null;
    if (match && index === segments.length - 1 && index > 0) {
      parameter = match[1];
      continue;
    }
    if (kind === 'command' && segment.startsWith('[')) {
      throw new AddConventionError(
        `zhin add 只生成必填参数目录 [name]，且只能放在最后一段、前面至少有一段命令名：${JSON.stringify(name)}。`
          + '[[name]] / [...name] / [[...name]] 请手动创建目录并在 defineCommand({ params }) 声明（见 https://zhin.js.org/authoring/commands）',
      );
    }
    throw new AddConventionError(`无效的名称段 ${JSON.stringify(segment)}（${JSON.stringify(name)}）：${hint}`);
  }
  return { segments, parameter };
}

function propertyKey(name: string): string {
  return /^[a-z][a-z0-9]*$/.test(name) ? name : `'${name}'`;
}

function propertyAccess(name: string): string {
  return /^[a-z][a-z0-9]*$/.test(name) ? `.${name}` : `['${name}']`;
}

/** Template sources; each is the smallest default export the authoring API accepts. */
export function conventionTemplate(
  kind: AddKind,
  segments: readonly string[],
  options: { parameter?: string; event?: string } = {},
): string {
  const label = segments.join(' ');
  switch (kind) {
    case 'command': {
      const { parameter } = options;
      if (!parameter) {
        return `import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '${label} 命令',
  execute: () => '${label}：运行中',
});
`;
      }
      const route = segments.slice(0, -1).join(' ');
      return `import { defineCommand } from 'zhin.js/command';

/** 目录 [${parameter}] 是必填参数，类型在 params 中声明：发送 \`${route} 你好\` 时 params${propertyAccess(parameter)} 为「你好」。 */
export default defineCommand({
  description: '${route} 命令',
  params: {
    ${propertyKey(parameter)}: { type: 'string', description: '${parameter} 参数' },
  },
  execute: ({ params }) => \`${route}：\${params${propertyAccess(parameter)}}\`,
});
`;
    }
    case 'middleware':
      return `import { defineMiddleware } from 'zhin.js/middleware';

/** 入站消息中间件：不处理时调用 next() 交给后续中间件与命令。 */
export default defineMiddleware({
  handle(_context, next) {
    return next();
  },
});
`;
    case 'handler': {
      const event = options.event ?? segments.join('.');
      const handle = CANONICAL_HANDLER_EVENTS.has(event)
        ? `  handle({ payload }) {
    // TODO: 处理 ${event}；payload 是统一事件对象
    void payload;
  },`
        : `  handle(...args) {
    // TODO: 处理 ${event}
    void args;
  },`;
      return `import { defineHandler } from 'zhin.js/handler';

export default defineHandler({
  event: '${event}',
${handle}
});
`;
    }
    case 'tool': {
      const name = segments[0];
      return `import { defineAgentTool } from '@zhin.js/tool';

export default defineAgentTool<{ text: string }>({
  // 模型根据 description 决定何时调用：写清楚它做什么、何时该用
  description: '${name} 工具',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '输入文本' },
    },
    required: ['text'],
  },
  execute({ text }) {
    return \`${name}：\${text}\`;
  },
});
`;
    }
    case 'component': {
      const name = segments[0];
      const props = `${toCapitalizedName(name)}Props`;
      return `import { defineComponent } from 'zhin.js/component';

interface ${props} {
  readonly title?: string;
}

export default defineComponent<${props}>({
  render({ title = '${name}' }) {
    return <text>{title}</text>;
  },
});
`;
    }
  }
}

function hasStackDependency(manifest: JsonObject, name: string): boolean {
  return ['dependencies', 'peerDependencies', 'optionalDependencies']
    .some((field) => isObject(manifest[field]) && name in (manifest[field] as JsonObject));
}

function objectField(manifest: JsonObject, field: string): JsonObject {
  if (!isObject(manifest[field])) manifest[field] = {};
  return manifest[field] as JsonObject;
}

/**
 * Declare the Feature in `zhin.features` and, when the package does not already depend on it,
 * as an optional peer plus devDependency (the `zhin new` policy; the Runtime rejects features
 * that are not declared as dependencies). Ranges follow the package's own zhin.js spec:
 * `workspace:` stays a workspace link, anything else gets the release range.
 */
export function declareFeature(manifest: JsonObject, featurePackage: string, pluginDirectory: string): string[] {
  const changes: string[] = [];
  const zhin = manifest.zhin as JsonObject;
  if (!Array.isArray(zhin.features)) zhin.features = [];
  const features = zhin.features as unknown[];
  const declared = features.some((entry) => entry === featurePackage
    || (isObject(entry) && entry.package === featurePackage));
  if (!declared) {
    features.push({ package: featurePackage, api: featureApiRange(featurePackage) });
    changes.push(`zhin.features 添加 ${featurePackage}（api ${featureApiRange(featurePackage)}）`);
  }
  if (hasStackDependency(manifest, featurePackage)) return changes;

  const zhinSpec = ['peerDependencies', 'devDependencies', 'dependencies']
    .map((field) => (isObject(manifest[field]) ? (manifest[field] as JsonObject)['zhin.js'] : undefined))
    .find((spec): spec is string => typeof spec === 'string');
  const workspace = zhinSpec?.startsWith('workspace:') === true;
  const release = workspace ? undefined : resolveStackRange(featurePackage, pluginDirectory);
  const peerRange = workspace ? 'workspace:^' : release!;
  const devRange = workspace ? 'workspace:*' : release!;

  objectField(manifest, 'peerDependencies')[featurePackage] = peerRange;
  objectField(manifest, 'peerDependenciesMeta')[featurePackage] = { optional: true };
  changes.push(`peerDependencies 添加 ${featurePackage}@${peerRange}（optional）`);
  const devDependencies = objectField(manifest, 'devDependencies');
  if (!(featurePackage in devDependencies)) {
    devDependencies[featurePackage] = devRange;
    changes.push(`devDependencies 添加 ${featurePackage}@${devRange}`);
  }
  return changes;
}

/** Validate, write the convention file and update package.json. Throws {@link AddConventionError}. */
export function addConvention(options: AddConventionOptions): AddConventionResult {
  const { kind } = options;
  if (!isKind(kind)) {
    throw new AddConventionError(
      `未知的类型 ${JSON.stringify(kind)}（可选 ${ADD_KINDS.join(' | ')}）。安装插件请用 zhin install <包名>`,
    );
  }
  const spec = KIND_SPECS[kind];
  const { segments, parameter } = parseConventionName(kind, options.name);
  let event: string | undefined;
  if (kind === 'handler') {
    event = options.event ?? segments.join('.');
    if (options.event === undefined && !CANONICAL_HANDLER_EVENTS.has(event)) {
      throw new AddConventionError(
        `handlers/${segments.join('/')} 不对应内置事件（${[...CANONICAL_HANDLER_EVENTS].join(' | ')}）；请用 --event <事件> 指定`,
      );
    }
    if (!EVENT_PATTERN.test(event)) {
      throw new AddConventionError(`无效的事件名 ${JSON.stringify(event)}：形如 message.receive`);
    }
  } else if (options.event !== undefined) {
    throw new AddConventionError('--event 只用于 handler');
  }

  const plugin = findPluginPackage(options.cwd ?? process.cwd());
  const file = [spec.directory, ...segments, spec.file].join('/');
  const target = path.join(plugin.directory, ...file.split('/'));
  const exists = fs.existsSync(target);
  if (exists && !options.force) {
    throw new AddConventionError(`${file} 已存在；加 --force 覆盖`);
  }

  const featurePackage = CONVENTION_FEATURE_PACKAGES[spec.directory]!;
  const manifest = structuredClone(plugin.manifest);
  const manifestChanges = declareFeature(manifest, featurePackage, plugin.directory);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, conventionTemplate(kind, segments, { parameter, event }), 'utf8');
  if (manifestChanges.length > 0) {
    fs.writeFileSync(path.join(plugin.directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return { pluginDirectory: plugin.directory, file, overwritten: exists, manifestChanges };
}

interface AddCommandOptions {
  cwd?: string;
  force?: boolean;
  event?: string;
}

export const addCommand = new Command('add')
  .description('在当前插件包生成约定目录能力文件，并在 package.json#zhin.features 声明对应 Feature')
  .argument('<kind>', `能力类型（${ADD_KINDS.join(' | ')}）`)
  .argument('[name]', '名称；command / handler 可用 / 分段（如 gh/issue、message/receive），command 末段可为 [param]')
  // `zhin add <包名>` 以前是 `zhin install` 的别名：不是能力类型时原样转给 install（含其选项）。
  .allowUnknownOption()
  .allowExcessArguments()
  .option('--cwd <dir>', '插件目录（默认从当前目录向上找最近的 package.json）')
  .option('--force', '覆盖已存在的文件', false)
  .option('--event <event>', 'handler 监听的事件（默认由路径推断，如 message/receive → message.receive）')
  .addHelpText('after', [
    '',
    '生成位置：',
    '  command     commands/<path>/index.ts      defineCommand（zhin.js/command）',
    '  middleware  middlewares/<name>/index.ts   defineMiddleware（zhin.js/middleware）',
    '  handler     handlers/<path>/index.ts      defineHandler（zhin.js/handler）',
    '  tool        tools/<name>/index.ts         defineAgentTool（@zhin.js/tool）',
    '  component   components/<name>/index.tsx   defineComponent（zhin.js/component）',
    '',
    '示例：',
    '  zhin add command gh/issue',
    '  zhin add command echo/[text]',
    '  zhin add handler message/receive',
    '  zhin add handler welcome --event notice.receive',
    '',
    '已存在的文件不会被覆盖（除非 --force）；已声明的 Feature 与依赖保持不变。',
    '第一个参数不是能力类型时按 zhin install 处理（旧写法 zhin add <包名> 仍可用，建议改用 zhin install）。',
  ].join('\n'))
  .action(async (kind: string, name: string | undefined, options: AddCommandOptions, command: Command) => {
    if (!isAddKind(kind)) {
      logger.warn(`zhin add <包名> 已改为 zhin install <包名>，这次按安装处理（能力类型：${ADD_KINDS.join(' / ')}）`);
      await installCommand.parseAsync(command.args, { from: 'user' });
      return;
    }
    if (name === undefined) {
      logger.error(`缺少名称：zhin add ${kind} <name>`);
      process.exitCode = 1;
      return;
    }
    try {
      const result = addConvention({ kind, name, cwd: options.cwd, force: options.force, event: options.event });
      const relativeRoot = path.relative(process.cwd(), result.pluginDirectory) || '.';
      logger.success(`${result.overwritten ? '已覆盖' : '已创建'} ${path.join(relativeRoot, result.file)}`);
      if (result.manifestChanges.length === 0) {
        logger.log('  package.json 已声明所需 Feature，未修改');
      } else {
        for (const change of result.manifestChanges) logger.log(`  package.json：${change}`);
        if (result.manifestChanges.some((change) => change.includes('Dependencies'))) {
          logger.log('  依赖有变化：请运行 pnpm install');
        }
      }
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      if (!(error instanceof AddConventionError) && error instanceof Error && error.stack && process.env.DEBUG) {
        logger.error(error.stack);
      }
      process.exitCode = 1;
    }
  });
