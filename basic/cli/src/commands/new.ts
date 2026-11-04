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
  RUNTIME_ENTRIES_SCRIPT,
  RUNTIME_ENTRIES_SCRIPT_PATH,
  runtimeEntryJsGlobs,
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
      await createPluginPackage({ pluginDir, pluginName: name, packageName, options });

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
        logger.log('  发布到 npm：在插件目录执行 npx @zhin.js/cli pub --dry-run 预览，再 npx @zhin.js/cli pub（npx @zhin.js/cli 在任何版本下都可靠；npx zhin 要 zhin@4 起才是同一个 CLI）');
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

/** A single scaffold request, including the explicit CLI choices that define its output. */
interface CreatePluginPackageRequest {
  readonly pluginDir: string;
  readonly pluginName: string;
  readonly packageName: string;
  readonly options: NewPluginOptions;
}
async function createPluginPackage({ pluginDir, pluginName, packageName, options }: CreatePluginPackageRequest) {
  const kind: PluginKind = options.type ?? 'normal';
  const capitalizedName = toCapitalizedName(pluginName);

  // Resolve the authoring contract before creating any output. Workspace protocols stay local;
  // an external plugin uses the release floor, even when its eventual Host still needs upgrading.
  const workspace = workspaceStackRanges(process.cwd());
  const stack = workspace ?? (() => {
    const ranges = resolvePluginStackRanges(process.cwd());
    return { peer: ranges, dev: ranges };
  })();

  await fs.ensureDir(pluginDir);
  await fs.ensureDir(path.join(pluginDir, 'tests'));
  await fs.ensureDir(path.join(pluginDir, 'src'));
  await fs.ensureDir(path.join(pluginDir, 'skills', pluginName));
  if (kind === 'normal') {
    await fs.ensureDir(path.join(pluginDir, 'commands', `${pluginName}-echo`));
  }
  if (kind === 'adapter') {
    await fs.ensureDir(path.join(pluginDir, 'adapters'));
  }

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

  // 模板只用一种配置来源：schema.json。definePlugin({ config }) 与 schema.json 同时存在会拒绝启动。
  const configSourceNote = ' * 配置来源：根目录 schema.json（模板唯一的配置声明）。如改用 definePlugin({ config: Schema.object(...) })，'
    + '请先删除 schema.json，两者同时存在会拒绝启动（见 https://zhin.js.org/authoring/define-plugin#choose-a-config-source）。';

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
        : kind === 'normal'
          ? {
              // 与 src/index.ts 的 ${capitalizedName}Config 保持一致
              echoPrefix: {
                type: 'string',
                default: '你说：',
                description: '回显命令的前缀',
              },
            }
          : {},
  };
  await fs.writeJson(path.join(pluginDir, 'schema.json'), schemaJson, { spaces: 2 });

  // tsconfig.json 负责类型检查（含 tests）；tsconfig.build.json 把 src/ 编译到 lib/（.js + .d.ts）
  const tsconfigs = createPluginTsconfigs(kind);
  await fs.writeJson(path.join(pluginDir, 'tsconfig.json'), tsconfigs.tsconfig, { spaces: 2 });
  await fs.writeJson(path.join(pluginDir, 'tsconfig.build.json'), tsconfigs.build, { spaces: 2 });
  // prepack：plugin.ts 与约定目录 → 同目录 .js（src/ 导入改写到 lib/）；postpack 清除
  await fs.outputFile(path.join(pluginDir, RUNTIME_ENTRIES_SCRIPT_PATH), RUNTIME_ENTRIES_SCRIPT, 'utf8');

  // src/：库代码，构建到 lib/ 并生成 .d.ts；plugin.ts 与约定目录用 '../src/xxx.js' 引用
  const libraryTs = `/**
 * 库代码：构建到 lib/（.js + .d.ts），也是本包对外的 import 入口（package.json#exports）。
 * plugin.ts 和约定目录里用 './src/index.js' / '../../src/index.js' 引用；
 * 打包时这些导入会被改写成 lib/。
 */
export const displayName = '${capitalizedName}${kind === 'adapter' ? ' Adapter' : ''}';
${kind === 'normal' ? `
/**
 * 插件配置（app 配置 <instanceKey>）的类型，与 schema.json 保持一致。
 * 约定目录里用 defineCommand.withConfig<${capitalizedName}Config>()({...}) 拿到有类型的 config。
 */
export interface ${capitalizedName}Config {
  readonly echoPrefix?: string;
}

/** 回显命令的文本格式（commands/${pluginName}-echo/[text] 使用）。 */
export function formatEcho(text: string, prefix = '你说：'): string {
  return \`\${prefix}\${text}\`;
}
` : ''}${kind === 'adapter' ? `\nexport * from './adapter.js';\n` : ''}`;
  await fs.writeFile(path.join(pluginDir, 'src', 'index.ts'), libraryTs, 'utf8');

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
import { displayName } from './src/index.js';

/**
 * 服务型约定插件：setup(context) 在插件装配时执行。
 * 宿主资源经 context.resources 按需取用：
 * - databaseHostToken：结构化存储（db.define / select / insert ...）
 * - scheduleHostToken / outboundHostToken 等同理（参考 plugins/features/process-monitor、plugins/utils/rss）
 * 清理回调统一注册到 context.lifecycle.add(dispose)。
${configSourceNote}
 */
export default definePlugin({
  name: '${pluginName}',
  metadata: {
    displayName,
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
import { displayName } from './src/index.js';

/**
 * 适配器约定插件入口：适配器定义在 adapters/ 目录（defineAdapter），
 * Endpoint 实例配置来自 app 配置 <instanceKey>（见 schema.json）。
${configSourceNote}
 */
export default definePlugin({
  name: '${pluginName}',
  metadata: {
    displayName,
  },
});
`;
    await fs.writeFile(path.join(pluginDir, 'plugin.ts'), pluginTs, 'utf8');
  } else {
    const pluginTs = `import { definePlugin } from 'zhin.js';
import { displayName } from './src/index.js';

/**
 * 约定式插件入口（Plugin Runtime）：
 * - commands/ 下的 defineCommand 模块即命令（文件名即命令名，支持 [param] 动态段目录）
 * - 如需初始化 / 清理逻辑，添加 setup(context)（参考 zhin new --type service）
${configSourceNote}
 */
export default definePlugin({
  name: '${pluginName}',
  metadata: {
    displayName,
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
import { formatEcho, type ${capitalizedName}Config } from '../../../src/index.js';

/**
 * 动态段命令：目录名 [text] 声明一个必需参数，类型在 params 中定义。
 * 聊天中发送 \`${pluginName}-echo 你好\` 即可触发，params.text 为「你好」。
 * defineCommand.withConfig<Config>() 先固定 config 类型，params 仍从定义推断（params.text: string）。
 */
export default defineCommand.withConfig<${capitalizedName}Config>()({
  description: '回显一段文本（动态段示例）',
  params: {
    text: { type: 'string', description: '要回显的文本' },
  },
  execute({ params, config }) {
    return formatEcho(params.text, config.echoPrefix);
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
    const adapterModuleTs = `/**
 * Public Adapter, native Client/Endpoint and authoring type registration.
 * Built into lib/ with declarations; the convention entry references these same classes.
 */
import { EventEmitter } from 'node:events';
import { Adapter, createEndpointSpecification, endpointSpec,
  type Endpoint, type EndpointIncomingMessage } from 'zhin.js/adapter';

export interface ${capitalizedName}AdapterConfig {
  id: string;
  /** 平台凭证等，按实际协议扩展 */
  token?: string;
}

/** Replace this protocol skeleton with the platform SDK Client when available. */
export class ${capitalizedName}Client extends EventEmitter<{ message: [EndpointIncomingMessage] }> {
  readonly token?: string;
  constructor(config: ${capitalizedName}AdapterConfig) { super(); this.token = config.token; }

  async connect(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    // TODO: Establish the platform transport and emit its native events.
  }
  async disconnect(): Promise<void> {
    // TODO: Idempotently release transport, heartbeat and reconnect resources.
  }
  async send(target: string, payload: unknown): Promise<string> {
    // TODO: Call the platform API and return its real message ID.
    return \`stub-message-id:\${target}:\${typeof payload}\`;
  }
}

export class ${capitalizedName}Endpoint extends ${capitalizedName}Client implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start: signal => this.connect(signal),
    open() {},
    close() {},
    stop: () => this.disconnect(),
    send: request => this.send(request.conversation.id, request.payload),
  });

  constructor(config: ${capitalizedName}AdapterConfig) {
    super(config);
    // Attach before connecting so the first platform event cannot be lost.
    this.on('message', message => {
      const events = this[endpointSpec].events;
      void events.run(() => events.message(message)).catch(error => console.error(error));
    });
  }
}

export class ${capitalizedName}Adapter extends Adapter<${capitalizedName}Endpoint, ${capitalizedName}AdapterConfig> {
  protected createEndpoint(config: ${capitalizedName}AdapterConfig): ${capitalizedName}Endpoint {
    return new ${capitalizedName}Endpoint(config);
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { '${pluginName}': ${capitalizedName}Adapter }
}

`;
    await fs.outputFile(path.join(pluginDir, 'src', 'adapter.ts'), adapterModuleTs, 'utf8');
    const adapterTs = `/** Convention discovery entry; public classes and types live in src/adapter.ts. */
import { defineAdapter } from 'zhin.js/adapter';
import { ${capitalizedName}Adapter, type ${capitalizedName}AdapterConfig } from '../../src/adapter.js';

export default defineAdapter<${capitalizedName}AdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  createAdapter: () => new ${capitalizedName}Adapter(),
});
`;
    await fs.outputFile(path.join(pluginDir, 'adapters', pluginName, 'index.ts'), adapterTs, 'utf8');
  }

  const readmeIntro =
    kind === 'adapter'
      ? `${capitalizedName} 适配器（\`zhin new --type adapter\` 生成）：约定式 Plugin Runtime 形态，\`adapters/\` 下的 \`defineAdapter\` 模块即适配器；Adapter 管理账号配置与生命周期；Endpoint 继承平台 Client，通过 endpointSpec 接入统一消息链路，保留原生 API 与事件。`
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

- \`plugin.ts\`：插件入口（\`definePlugin\`）。\`zhin.entry\` 写的是 \`./plugin.js\`：本地运行时自动回退到 \`plugin.ts\`，npm 包里是打包时生成的 \`plugin.js\`
- \`src/\`：库代码，\`pnpm build\` 编译到 \`lib/\`（\`.js\` + \`.d.ts\`），也是 \`import '${packageName}'\` 的入口；\`plugin.ts\` 和约定目录用 \`./src/xxx.js\` 这样的相对路径引用
- \`schema.json\`：实例配置（\`<instanceKey>\`）的 JSON Schema，也是本插件唯一的配置声明。如改用 \`definePlugin({ config: Schema.object(...) })\` 获得自动推导的配置类型，请先删除 \`schema.json\`：两者同时存在会拒绝启动，Zhin 不会替你挑一个（见 https://zhin.js.org/authoring/define-plugin#choose-a-config-source）
${kind === 'normal' ? '- `commands/**/index.ts`：命令入口（`defineCommand`），目录段 `[name]` 声明动态参数（类型在 `params` 中定义）\n' : ''}${kind === 'adapter' ? '- `adapters/<name>/index.ts`：薄约定入口（`defineAdapter`），`createAdapter` 返回 Adapter 实例\n- `src/adapter.ts`：公开 Client、Endpoint、Adapter、配置与 AdapterRegistry 类型注册，经 `src/index.ts` 导出\n' : ''}- \`skills/<name>/SKILL.md\`：AI 技能包，可附带参考资料与脚本（随 npm 包发布）
- \`tests/\`：Vitest 运行时契约测试

## AI 技能（skills）

本包包含 \`skills/${pluginName}/SKILL.md\`。请按实际能力修改 \`description\` / \`tools\` 等 frontmatter；参考资料和脚本可放在同一 Skill 目录。

## 开发

\`\`\`bash
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit（含 tests）
pnpm build       # src/ → lib/（.js + .d.ts）
pnpm pack        # prepack 先 build，再把 plugin.ts 与约定目录编译成同目录 .js（src/ 导入改写为 lib/），postpack 清除
\`\`\`

发布包只包含 \`lib/\`、\`plugin.js\`、约定目录里的 \`.js\`、\`schema.json\`、\`skills/\` 和文档，不包含 \`.ts\` 源码、测试和配置（见 \`package.json#files\`）。

## 发布

\`\`\`bash
npx @zhin.js/cli pub --dry-run   # 构建并预览 tarball，不发布
npx @zhin.js/cli pub             # 确认后发布；CI 里加 --yes
\`\`\`

建议写 \`npx @zhin.js/cli\`：从 \`zhin@4\` 起 \`npx zhin\` 与它等价，但 npx 缓存或锁定里残留的 \`zhin@3.x\` 是已停止维护的旧包。

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
  const generatedJs = runtimeEntryJsGlobs();
  const gitignoreContent = `node_modules/
lib/
coverage/
*.log
.DS_Store
.zhin/
# prepack 生成的 JavaScript（随 npm 包发布，postpack 会清除，不进仓库）
${generatedJs.join('\n')}
`;

  await fs.writeFile(path.join(pluginDir, '.gitignore'), gitignoreContent);

  await generateTestFile({ pluginDir, pluginName, packageName, kind });

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
/** Generated acceptance tests must describe the same public package and convention kind. */
interface GeneratePluginTestRequest {
  readonly pluginDir: string;
  readonly pluginName: string;
  readonly packageName: string;
  readonly kind: PluginKind;
}
async function generateTestFile({ pluginDir, pluginName, packageName, kind }: GeneratePluginTestRequest) {
  const testsDir = path.join(pluginDir, 'tests');
  let testContent: string;

  if (kind === 'adapter') {
    const capitalizedName = toCapitalizedName(pluginName);
    testContent = `import { describe, expect, it } from 'vitest';
import { AdapterIndex, adapterFeatureId, endpointEventGatewayToken, endpointSpec, parseAdapterDefinition } from 'zhin.js/adapter';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from 'zhin.js';
import plugin from '../plugin.ts';
import adapter from '../adapters/${pluginName}/index.ts';
import { ${capitalizedName}Client, ${capitalizedName}Endpoint } from '../src/index.js';

describe('${packageName}', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('${pluginName}');
    expect(parseAdapterDefinition(adapter)).toBe(adapter);
  });

  it('creates a native Client endpoint through its owning Adapter', async () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId,
      localName: '${pluginName}', source: '/adapters/${pluginName}/index.ts', definition: adapter });
    const snapshot: RuntimeSnapshot = {
      generation: 1, root,
      tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '${packageName}', packageRoot: '/', children: [] }]]),
      config: new Map([[root, { id: 'test-bot' }]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
      resources: new Map([[root, new Map([[endpointEventGatewayToken.id, { receive: async () => undefined }]])]]),
    };
    const index = await AdapterIndex.create([slot], snapshot, new AbortController().signal);
    try {
      await index.start();
      const endpoint = index.client<${capitalizedName}Endpoint>('${pluginName}', 'test-bot');
      expect(endpoint).toBeInstanceOf(${capitalizedName}Client);
      expect(endpoint).toBeInstanceOf(${capitalizedName}Endpoint);
      expect(endpoint[endpointSpec].identity.id).toBe(index.resolve('${pluginName}', 'test-bot'));
      await expect(index.send(endpoint[endpointSpec].identity.id, { conversation: { endpoint: { adapter: '${pluginName}', id: 'test-bot' },
        kind: 'private', id: 'c1' }, payload: 'hi' })).resolves.toBeTruthy();
    } finally { await index.stop(); }
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

// source: runCommand first applies the Runtime's convention-path rules, so a directory layout the
// Runtime would reject (e.g. commands/a/[x]/[...y]) fails here instead of only at startup.
const mainSource = new URL('../commands/${pluginName}/index.ts', import.meta.url);
const echoSource = new URL('../commands/${pluginName}-echo/[text]/index.ts', import.meta.url);

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
    const result = await runCommand(fake, mainCommand, { source: mainSource, input: createFakeMessage() });
    expect(String(result)).toContain('运行中');
    await fake.dispose();
  });

  it('echo command echoes the dynamic segment', async () => {
    const fake = await runPluginSetup(plugin);
    const result = await runCommand(fake, echoCommand, {
      source: echoSource,
      input: createFakeMessage({ content: '${pluginName}-echo 你好' }),
      args: ['你好'],
      params: { text: '你好' },
    });
    expect(String(result)).toContain('你好');
    await fake.dispose();
  });

  it('echo command reads the typed plugin config', async () => {
    const fake = await runPluginSetup(plugin, { config: { echoPrefix: '> ' } });
    const result = await runCommand(fake, echoCommand, {
      source: echoSource,
      input: createFakeMessage({ content: '${pluginName}-echo 你好' }),
      args: ['你好'],
      params: { text: '你好' },
    });
    expect(result).toBe('> 你好');
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
