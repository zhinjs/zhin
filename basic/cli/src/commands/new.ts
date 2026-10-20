import { Command } from 'commander';
import { formatCompact } from '@zhin.js/logger';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execSync } from 'node:child_process';
import {
  createPluginManifest,
  createPluginTsconfigs,
  resolvePluginPackageName,
  resolvePluginStackRanges,
  sourceDirectories,
  workspaceStackRanges,
  type PluginKind,
} from './new-plugin-manifest.js';

interface NewPluginOptions {
  skipInstall?: boolean;
  isOfficial?: boolean;
  packageName?: string;
  type?: PluginKind;
  standalone?: boolean;
}

const PLUGIN_KINDS: readonly PluginKind[] = ['normal', 'service', 'adapter'];

/**
 * Plugin identity 约束（见 packages/im/plugin-runtime/src/plugin.ts 的 definePlugin
 * 与 packages/im/plugin-runtime/src/identity.ts）：小写字母开头，仅小写字母/数字/横线。
 */
const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const PLUGIN_NAME_HINT = '插件名称需匹配 /^[a-z][a-z0-9-]*$/（小写字母开头，仅小写字母、数字、横线）';

/** my-cool-plugin → MyCoolPlugin，用作 displayName / 类型名 */
function toCapitalizedName(pluginName: string): string {
  return (
    pluginName.charAt(0).toUpperCase() +
    pluginName.slice(1).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  );
}

export const newCommand = new Command('new')
  .description('创建约定式插件包模板（Plugin Runtime）；独立插件包的官方入口：zhin new <name> --standalone')
  .argument('[plugin-name]', '插件名称（如: my-plugin，需匹配 /^[a-z][a-z0-9-]*$/）')
  .option('--is-official', '官方插件（包名使用 @zhin.js/ 作用域，仅限本仓库）', false)
  .option('--package-name <name>', 'npm 包名（默认 zhin.js-<插件名>；也可用自己的 scope，如 @me/zhin-plugin-x）')
  .option('--skip-install', '跳过依赖安装（插件目录与 app 根都不运行 pnpm install）', false)
  .option('--standalone', '独立插件：在当前目录下创建 ./<name>/，不依赖也不修改任何 Bot 项目（外部插件作者使用）', false)
  .option('--type <type>', '插件类型 (normal|service|adapter)')
  .action(async (pluginName: string, options: NewPluginOptions) => {
    try {
      let name = pluginName;
      // Without a TTY inquirer waits forever for an answer (CI, agents, `< /dev/null`): fail fast instead.
      const interactive = Boolean(process.stdin.isTTY);
      if (!interactive && (!name || !options.type)) {
        logger.error(
          `非交互环境需要显式参数：zhin new <plugin-name> --type <${PLUGIN_KINDS.join('|')}>`
            + '（缺少：' + [!name && '插件名称', !options.type && '--type'].filter(Boolean).join('、') + '）',
        );
        process.exit(1);
      }
      if (!name) {
        const { pluginName: inputName } = await inquirer.prompt([
          {
            type: 'input',
            name: 'pluginName',
            message: '请输入插件名称:',
            default: 'my-plugin',
            validate: (input: string) => {
              if (!input.trim()) {
                return '插件名称不能为空';
              }
              if (!PLUGIN_NAME_PATTERN.test(input)) {
                return PLUGIN_NAME_HINT;
              }
              return true;
            }
          }
        ]);
        name = inputName;
      }

      if (!PLUGIN_NAME_PATTERN.test(name)) {
        logger.error(PLUGIN_NAME_HINT);
        process.exit(1);
      }
      if (options.type && !PLUGIN_KINDS.includes(options.type)) {
        logger.error(`未知的插件类型: ${options.type}（可选 ${PLUGIN_KINDS.join(' | ')}）`);
        process.exit(1);
      }
      const packageName = resolvePluginPackageName(name, options);

      // 确定插件目录
      const pluginDir = options.standalone
        ? path.resolve(process.cwd(), name)
        : path.resolve(process.cwd(), 'plugins', name);

      // 检查目录是否已存在
      if (fs.existsSync(pluginDir)) {
        logger.error(`插件目录已存在: ${pluginDir}`);
        process.exit(1);
      }

      // 询问插件类型（未传 --type 时）
      let resolvedType: PluginKind = options.type ?? 'normal';
      if (!options.type) {
        const { type } = await inquirer.prompt([
          {
            // inquirer ≥ 10 removed the `list` alias; `select` is the single-choice prompt.
            type: 'select',
            name: 'type',
            message: '请选择插件类型:',
            choices: [
              { name: '普通插件 (Normal)', value: 'normal' },
              { name: '服务 (Service)', value: 'service' },
              { name: '适配器 (Adapter)', value: 'adapter' },
            ],
            default: 'normal',
          },
        ]);
        resolvedType = type;
      }
      options.type = resolvedType;

      const typeLabel = options.type === 'service' ? '服务' : options.type === 'adapter' ? '适配器' : '插件';
      logger.info(formatCompact( { cmd: 'new', op: 'create', type: typeLabel, name }));

      // 创建插件包结构
      await createPluginPackage(pluginDir, name, packageName, options);

      if (options.standalone) {
        logger.success(`✓ 独立插件包 ${name} 创建成功！`);
        logger.log('');
        logger.log('📝 下一步操作：');
        logger.log(`  cd ${name}`);
        logger.log('  pnpm test && pnpm typecheck');
        logger.log('  在 Bot 项目里挂载试用：在插件目录 pnpm pack，在 Bot 项目根执行');
        logger.log(`    pnpm add -w <插件目录>/${packageName.replace(/^@/, '').replace('/', '-')}-0.1.0.tgz`);
        logger.log(`  在 Bot 主配置设置 configVersion: 2、plugins: { ${name}: "${packageName}" }，然后 pnpm dev`);
        logger.log('  不要直接 pnpm add <插件目录>：插件自己的 devDependencies 会让 zhin 包出现两份实例；');
        logger.log(`  需要热重载：在 Bot 项目根执行 zhin dev link <插件目录>（实例名 ${name}），见 https://zhin.js.org/authoring/local-dev#dev-link-plugin`);
        logger.log('  发布到 npm：在插件目录执行 pnpm publish（prepack 会自动构建 plugin.js）');
        return;
      }

      if (!fs.existsSync(path.resolve(process.cwd(), 'package.json'))) {
        logger.warn('当前目录不是 Bot 项目；要创建可独立发布的插件包，请使用 zhin new <name> --standalone');
      }

      // 自动添加到 app/package.json 并提示挂载方式
      await addPluginToApp(name, packageName, options.skipInstall);

      logger.success(`✓ 插件包 ${name} 创建成功！`);
      logger.log('');
      logger.log('📝 下一步操作：');
      logger.log('  1. 在 app 主配置的 plugins 映射中添加：');
      logger.log(`     ${name}: "${packageName}"`);
      logger.log('  2. pnpm dev  # 即 zhin runtime start（约定式插件运行时）');
      logger.log('');
      logger.log('📦 发布到 npm（在项目根）：');
      logger.log(`  pnpm exec zhin pub ${name}`);
      logger.log(`  # 或嵌套目录: pnpm exec zhin pub adapters/<适配器名>`);
      logger.log('');
      logger.log('🤖 AI 技能：可编辑 plugins/' + name + '/skills/' + name + '/SKILL.md（随 npm 包发布）');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error(`创建插件失败: ${errorMessage}`);
      if (errorStack && process.env.DEBUG) {
        logger.error(errorStack);
      }
      process.exit(1);
    }
  });

async function createPluginPackage(
  pluginDir: string,
  pluginName: string,
  packageName: string,
  options: NewPluginOptions,
) {
  const kind: PluginKind = options.type ?? 'normal';
  const capitalizedName = toCapitalizedName(pluginName);

  await fs.ensureDir(pluginDir);
  await fs.ensureDir(path.join(pluginDir, 'tests'));
  await fs.ensureDir(path.join(pluginDir, 'skills', pluginName));
  if (kind === 'normal') {
    await fs.ensureDir(path.join(pluginDir, 'commands', `${pluginName}-echo`));
  }
  if (kind === 'adapter') {
    await fs.ensureDir(path.join(pluginDir, 'adapters'));
  }

  // 在本仓库根执行时用 workspace 协议；否则从已安装版本推导 ^x.y.z（不再写 latest）
  const workspace = workspaceStackRanges(process.cwd());
  const stack = workspace ?? (() => {
    const ranges = resolvePluginStackRanges(process.cwd());
    return { peer: ranges, dev: ranges };
  })();

  const description =
    kind === 'adapter'
      ? `Zhin.js ${capitalizedName} 适配器（Plugin Runtime）`
      : kind === 'service'
        ? `Zhin.js ${capitalizedName} 服务（Plugin Runtime）`
        : `Zhin.js ${capitalizedName} 插件（Plugin Runtime）`;

  const keywords =
    kind === 'adapter'
      ? (['zhin.js', 'adapter', 'bot', pluginName] as string[])
      : kind === 'service'
        ? (['zhin.js', 'service', pluginName] as string[])
        : (['zhin.js', 'plugin', pluginName] as string[]);

  const packageJson = createPluginManifest({
    pluginName,
    packageName,
    kind,
    description,
    keywords,
    peerRanges: stack.peer,
    devRanges: stack.dev,
  });

  await fs.writeJson(path.join(pluginDir, 'package.json'), packageJson, { spaces: 2 });

  // schema.json：<instanceKey> 配置的 JSON Schema；适配器带稳定的 endpoint id
  const schemaJson: Record<string, unknown> = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties:
      kind === 'adapter'
        ? {
            id: {
              type: 'string',
              default: `${pluginName}-bot`,
              description: 'Endpoint 唯一标识',
            },
          }
        : {},
  };
  await fs.writeJson(path.join(pluginDir, 'schema.json'), schemaJson, { spaces: 2 });

  // tsconfig.json 负责类型检查（含 tests）；tsconfig.build.json 把 plugin.ts 与约定目录编译成同目录 .js
  const tsconfigs = createPluginTsconfigs(kind);
  await fs.writeJson(path.join(pluginDir, 'tsconfig.json'), tsconfigs.tsconfig, { spaces: 2 });
  await fs.writeJson(path.join(pluginDir, 'tsconfig.build.json'), tsconfigs.build, { spaces: 2 });

  // Vitest：与 tests/ 目录配套
  const vitestConfig = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
`;
  await fs.writeFile(path.join(pluginDir, 'vitest.config.ts'), vitestConfig, 'utf8');

  // plugin.ts：约定式插件入口
  if (kind === 'service') {
    const pluginTs = `import { definePlugin, databaseHostToken } from 'zhin.js';

/**
 * 服务型约定插件：setup(context) 在插件装配时执行。
 * 宿主资源经 context.resources 按需取用：
 * - databaseHostToken：结构化存储（db.define / select / insert ...）
 * - scheduleHostToken / outboundHostToken 等同理（参考 plugins/features/process-monitor、plugins/utils/rss）
 * 清理回调统一注册到 context.lifecycle.add(dispose)。
 */
export default definePlugin({
  name: '${pluginName}',
  metadata: {
    displayName: '${capitalizedName}',
  },
  setup(context) {
    if (context.resources.has(databaseHostToken)) {
      // const db = context.resources.use(databaseHostToken);
      // db.define('${pluginName}_kv', {
      //   key: { type: 'text', nullable: false },
      //   value: { type: 'text', default: '' },
      // });
    }

    // TODO: 启动你的服务（定时器、连接、后台任务……）
    context.lifecycle.add(() => {
      // TODO: 插件卸载 / 热重载时释放资源
    });
  },
});
`;
    await fs.writeFile(path.join(pluginDir, 'plugin.ts'), pluginTs, 'utf8');
  } else if (kind === 'adapter') {
    const pluginTs = `import { definePlugin } from 'zhin.js';

/**
 * 适配器约定插件入口：适配器定义在 adapters/ 目录（defineAdapter），
 * Endpoint 实例配置来自 app 配置 <instanceKey>（见 schema.json）。
 */
export default definePlugin({
  name: '${pluginName}',
  metadata: {
    displayName: '${capitalizedName} Adapter',
  },
});
`;
    await fs.writeFile(path.join(pluginDir, 'plugin.ts'), pluginTs, 'utf8');
  } else {
    const pluginTs = `import { definePlugin } from 'zhin.js';

/**
 * 约定式插件入口（Plugin Runtime）：
 * - commands/ 下的 defineCommand 模块即命令（文件名即命令名，支持 [param] 动态段目录）
 * - 如需初始化 / 清理逻辑，添加 setup(context)（参考 zhin new --type service）
 */
export default definePlugin({
  name: '${pluginName}',
  metadata: {
    displayName: '${capitalizedName}',
  },
});
`;
    await fs.writeFile(path.join(pluginDir, 'plugin.ts'), pluginTs, 'utf8');
  }

  if (kind === 'normal') {
    const commandTs = `import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '${capitalizedName} 示例命令',
  execute() {
    return '${capitalizedName} 运行中！';
  },
});
`;
    await fs.outputFile(path.join(pluginDir, 'commands', pluginName, 'index.ts'), commandTs, 'utf8');

    const echoCommandTs = `import { defineCommand } from 'zhin.js/command';

/**
 * 动态段命令：目录名 [text] 声明一个必需参数，类型在 params 中定义。
 * 聊天中发送 \`${pluginName}-echo 你好\` 即可触发，params.text 为「你好」。
 */
export default defineCommand({
  description: '回显一段文本（动态段示例）',
  params: {
    text: { type: 'string', description: '要回显的文本' },
  },
  execute({ params }) {
    return \`你说：\${String(params.text ?? '')}\`;
  },
});
`;
    await fs.outputFile(
      path.join(pluginDir, 'commands', `${pluginName}-echo`, '[text]', 'index.ts'),
      echoCommandTs,
      'utf8',
    );
  }

  if (kind === 'adapter') {
    const adapterTs = `/**
 * Convention entry: discover \`adapters/${pluginName}/index.ts\` → defineAdapter.
 * 最小形态参考 plugins/adapters/sandbox 与 plugins/adapters/email。
 */
import { Endpoint, defineAdapter, type EndpointSendRequest } from 'zhin.js/adapter';

export interface ${capitalizedName}AdapterConfig {
  /** Endpoint 唯一标识（对应 schema.json 的 id 字段） */
  id: string;
  /** 平台凭证等，按实际协议扩展 */
  token?: string;
}

export class ${capitalizedName}Client {
  constructor(readonly token?: string) {}

  async send(target: string, payload: unknown): Promise<string> {
    // TODO: 调用平台 SDK / HTTP API，返回平台侧消息 ID。
    return \`stub-message-id:\${target}:\${typeof payload}\`;
  }
}

export class ${capitalizedName}Endpoint extends Endpoint<${capitalizedName}Client> {
  readonly client: ${capitalizedName}Client;
  #opened = false;

  constructor(
    readonly endpointId: string,
    config: ${capitalizedName}AdapterConfig,
  ) {
    super();
    this.client = new ${capitalizedName}Client(config.token);
  }

  async start(_signal: AbortSignal): Promise<void> {
    // TODO: 建立账号 Transport；收到任意平台事件后，经 emit() 统一投递。
  }

  open(): void {
    this.#opened = true;
  }

  close(): void {
    this.#opened = false;
  }

  async stop(): Promise<void> {
    this.#opened = false;
    // TODO: 幂等释放 Transport、心跳和重连任务。
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    return this.client.send(conversation.id, payload);
  }

  /** 示例：消息、通知、请求、生命周期和平台扩展事件都使用同一个 emit()。 */
  admit(name: string, payload: unknown): Promise<unknown> {
    if (!this.#opened) return Promise.resolve(undefined);
    return this.emit(name, payload);
  }
}

export default defineAdapter<${capitalizedName}AdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    return new ${capitalizedName}Endpoint(String(context.id), context.config);
  },
});
`;
    await fs.outputFile(path.join(pluginDir, 'adapters', pluginName, 'index.ts'), adapterTs, 'utf8');
  }

  const readmeIntro =
    kind === 'adapter'
      ? `${capitalizedName} 适配器（\`zhin new --type adapter\` 生成）：约定式 Plugin Runtime 形态，\`adapters/\` 下的 \`defineAdapter\` 模块即适配器；Endpoint 只管理账号 Transport，平台 Client 暴露业务 API，所有入站事件经 Endpoint.emit() 统一投递。`
      : kind === 'service'
        ? `${capitalizedName} 服务插件（\`zhin new --type service\` 生成）：\`plugin.ts\` 的 \`setup(context)\` 负责初始化与清理，宿主资源（database/schedule/outbound）经 \`context.resources\` 按需取用。`
        : `${capitalizedName} 普通插件（\`zhin new\` / \`--type normal\` 生成）：\`commands/\` 下的 \`defineCommand\` 模块即命令，含动态段 \`[text]\` 示例。`;

  const standaloneUse = `在 Bot 项目安装本插件：\`pnpm add ${packageName}\`（发布前联调：在本目录 \`pnpm pack\` 后在 Bot 根目录 \`pnpm add -w <tgz 路径>\`；需要热重载时在 Bot 根目录执行 \`zhin dev link <本目录>\`，见 https://zhin.js.org/authoring/local-dev#dev-link-plugin。不要直接 \`pnpm add <本目录>\`，会出现 zhin 包多实例）。主配置使用以下格式；实例业务配置在顶层同名块，结构见 \`schema.json\`：

\`\`\`yaml
configVersion: 2
plugins:
  ${pluginName}: '${packageName}'
disable_plugins: []
${pluginName}: {}
\`\`\`

然后 \`pnpm dev\`（即 \`zhin runtime start\`）启动。`;
  const readmeUse = standaloneUse;

  const readmeContent = `# ${packageName}

${readmeIntro}

## 安装

\`\`\`bash
pnpm add ${packageName}
\`\`\`

## 挂载与使用

${readmeUse}

## 目录约定

- \`plugin.ts\`：插件入口（\`definePlugin\`）。\`zhin.entry\` 写的是 \`./plugin.js\`：本地运行时自动回退到 \`plugin.ts\`，npm 包里是构建出的 \`plugin.js\`
- \`schema.json\`：实例配置（\`<instanceKey>\`）的 JSON Schema
${kind === 'normal' ? '- `commands/**/index.ts`：命令入口（`defineCommand`），目录段 `[name]` 声明动态参数（类型在 `params` 中定义）\n' : ''}${kind === 'adapter' ? '- `adapters/<name>/index.ts`：适配器入口（`defineAdapter`），`create(context)` 返回 Endpoint 实例\n' : ''}- \`skills/<name>/SKILL.md\`：AI 技能包，可附带参考资料与脚本（随 npm 包发布）
- \`tests/\`：Vitest 运行时契约测试

## AI 技能（skills）

本包包含 \`skills/${pluginName}/SKILL.md\`。请按实际能力修改 \`description\` / \`tools\` 等 frontmatter；参考资料和脚本可放在同一 Skill 目录。

## 开发

\`\`\`bash
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit（含 tests）
pnpm build       # 把 plugin.ts 与约定目录编译成同目录 .js（pnpm pack / publish 前自动执行）
\`\`\`

\`zhin.js\` 与能力包（\`@zhin.js/command\` 等）是 peerDependencies：发布后由宿主 Bot 提供同一份；devDependencies 里的副本只用于本地测试和类型检查。

在 **本仓库** 根执行 \`zhin new\` 时：若存在 \`pnpm-workspace.yaml\`、\`packages/im/zhin/package.json\`，且根 \`package.json\` 声明了 \`zhin.js\`，模板会把 peer 写为 \`workspace:^\`、devDependencies 写为 \`workspace:*\`。

## 许可证

MIT
`;
  await fs.writeFile(path.join(pluginDir, 'README.md'), readmeContent, 'utf8');

  // 文件化技能模板（与官方插件一致，随 npm 包发布）
  const skillMdContent = `---
name: ${pluginName}
description: ${capitalizedName} 插件：请简要说明本插件为 AI 提供的工具能力与使用场景（供 Agent 发现与粗筛工具）。
keywords:
  - ${pluginName}
  - zhin
tags:
  - ${pluginName}
tools: []
---

## 执行规则

- 通过本插件注册的 \`${pluginName}_*\` 等工具完成具体任务；请根据实际工具名与参数补充说明。
`;
  await fs.writeFile(path.join(pluginDir, 'skills', pluginName, 'SKILL.md'), skillMdContent);

  // 创建 CHANGELOG.md
  const changelogContent = `# ${packageName}

## 0.1.0

### Features

- 初始版本
`;

  await fs.writeFile(path.join(pluginDir, 'CHANGELOG.md'), changelogContent);

  // 创建 .gitignore
  const generatedJs = ['plugin.js', ...sourceDirectories(kind).map((dir) => `${dir}/**/*.js`)];
  const gitignoreContent = `node_modules/
lib/
coverage/
*.log
.DS_Store
.zhin/
# pnpm build / prepack 生成的 JavaScript（随 npm 包发布，不进仓库）
${generatedJs.join('\n')}
`;

  await fs.writeFile(path.join(pluginDir, '.gitignore'), gitignoreContent);

  await generateTestFile(pluginDir, pluginName, packageName, kind);

  // 安装依赖
  if (!options.skipInstall) {
    logger.info(formatCompact( { cmd: 'new', op: 'install_deps' }));
    try {
      execSync('pnpm install', {
        cwd: pluginDir,
        stdio: 'inherit'
      });
      logger.success('✓ 依赖安装成功');
    } catch (error) {
      logger.warn(formatCompact( { cmd: 'new', op: 'install_deps_failed', hint: 'pnpm install' }));
    }
  }
}

/**
 * 生成运行时契约测试（形态参考 plugins/utils/repeater/tests/repeater-runtime.test.ts）
 */
async function generateTestFile(
  pluginDir: string,
  pluginName: string,
  packageName: string,
  kind: PluginKind,
) {
  const testsDir = path.join(pluginDir, 'tests');
  let testContent: string;

  if (kind === 'adapter') {
    const capitalizedName = toCapitalizedName(pluginName);
    testContent = `import { describe, expect, it } from 'vitest';
import { parseAdapterDefinition } from 'zhin.js/adapter';
import plugin from '../plugin.ts';
import adapter, { ${capitalizedName}Endpoint } from '../adapters/${pluginName}/index.ts';

describe('${packageName}', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('${pluginName}');
  });

  it('brands the convention adapter', () => {
    expect(parseAdapterDefinition(adapter)).toBe(adapter);
  });

  it('creates an endpoint that starts, sends and stops', async () => {
    const endpoint = await adapter.create({
      id: 'root/${pluginName}' as never,
      name: '${pluginName}',
      config: { id: 'test-bot' },
      use: () => ({
        receive: async () => ({ matched: false }),
        send: async () => undefined,
      }),
    } as never);
    expect(endpoint).toBeInstanceOf(${capitalizedName}Endpoint);
    const typed = endpoint as ${capitalizedName}Endpoint;

    await typed.start(new AbortController().signal);
    typed.open();
    const conversation = {
      endpoint: { adapter: '${pluginName}', id: 'test-bot' },
      kind: 'private',
      id: 'c1',
    } as const;
    await expect(typed.send({ conversation, payload: 'hi' })).resolves.toBeTruthy();
    await typed.stop();
  });
});
`;
  } else if (kind === 'service') {
    testContent = `import { describe, expect, it } from 'vitest';
import { runPluginSetup } from '@zhin.js/testing';
import plugin from '../plugin.ts';

describe('${packageName}', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('${pluginName}');
  });

  it('runs setup against typed fakes and disposes cleanly', async () => {
    // runPluginSetup provides in-memory Database / Schedule / Outbound hosts; see docs/authoring/testing.md.
    const fake = await runPluginSetup(plugin);
    expect(fake.missingRequirements(plugin)).toEqual([]);
    await fake.dispose();
  });
});
`;
  } else {
    testContent = `import { describe, expect, it } from 'vitest';
import { createFakeMessage, runCommand, runPluginSetup } from '@zhin.js/testing';
import { parseCommandDefinition } from 'zhin.js/command';
import plugin from '../plugin.ts';
import mainCommand from '../commands/${pluginName}/index.ts';
import echoCommand from '../commands/${pluginName}-echo/[text]/index.ts';

describe('${packageName}', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('${pluginName}');
  });

  it('brands the convention commands', () => {
    expect(parseCommandDefinition(mainCommand)).toBe(mainCommand);
    expect(parseCommandDefinition(echoCommand)).toBe(echoCommand);
  });

  // runCommand calls execute() with a typed context from the fake plugin (no \`as never\`).
  // It skips routing, parameter parsing and permit; use PluginTestKit for those (docs/authoring/testing.md).
  it('main command returns greeting text', async () => {
    const fake = await runPluginSetup(plugin);
    const result = await runCommand(fake, mainCommand, { input: createFakeMessage() });
    expect(String(result)).toContain('运行中');
    await fake.dispose();
  });

  it('echo command echoes the dynamic segment', async () => {
    const fake = await runPluginSetup(plugin);
    const result = await runCommand(fake, echoCommand, {
      input: createFakeMessage({ content: '${pluginName}-echo 你好' }),
      args: ['你好'],
      params: { text: '你好' },
    });
    expect(String(result)).toContain('你好');
    await fake.dispose();
  });
});
`;
  }

  await fs.writeFile(path.join(testsDir, `${pluginName}-runtime.test.ts`), testContent);
  logger.success('✓ 测试文件已生成');
}

async function addPluginToApp(pluginName: string, packageName: string, skipInstall?: boolean) {
  try {
    const rootPackageJsonPath = path.resolve(process.cwd(), 'package.json');

    // 检查根 package.json 是否存在
    if (!fs.existsSync(rootPackageJsonPath)) {
      logger.warn(formatCompact( { cmd: 'new', op: 'skip_deps', reason: 'no package.json' }));
      return;
    }

    const packageJson = await fs.readJson(rootPackageJsonPath);

    // 初始化 dependencies
    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }

    // 添加 workspace 依赖
    packageJson.dependencies[packageName] = 'workspace:*';

    // 写回文件
    await fs.writeJson(rootPackageJsonPath, packageJson, { spaces: 2 });

    logger.success(`✓ 已将 ${packageName} 添加到 app 的 dependencies`);
    logger.log('  挂载方式：在 app 主配置的 plugins 映射中添加：');
    logger.log(`    ${pluginName}: "${packageName}"`);
    logger.log('  （主配置需 configVersion: 2；业务配置写顶层同名块）');

    if (skipInstall) {
      logger.log('  已跳过依赖安装，稍后在项目根运行 pnpm install');
      return;
    }

    // 重新安装依赖
    logger.info(formatCompact( { cmd: 'new', op: 'update_deps' }));
    try {
      execSync('pnpm install', {
        cwd: process.cwd(),
        stdio: 'inherit'
      });
      logger.success('✓ 依赖更新成功');
    } catch (error) {
      logger.warn(formatCompact( { cmd: 'new', op: 'update_deps_failed', hint: 'pnpm install' }));
    }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(formatCompact( { cmd: 'new', op: 'add_deps_failed', error: errorMessage }));
    }
}
