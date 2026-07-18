import { Command } from 'commander';
import { formatCompact } from '@zhin.js/logger';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execSync } from 'node:child_process';

interface NewPluginOptions {
  skipInstall?: boolean;
  isOfficial?: boolean;
  type?: 'normal' | 'service' | 'adapter';
}

type PluginKind = 'normal' | 'service' | 'adapter';

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

/**
 * 在本仓库等「含 packages/im/zhin 的 pnpm workspace」根执行 zhin new 时，对齐 workspace 协议依赖。
 * 仅有 pnpm-workspace.yaml 但无 packages/im/zhin 时不启用，避免误写 workspace:* 导致 pnpm install 失败。
 */
function tryZhinWorkspaceDevDependencies(): Record<string, string> | null {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))) return null;
  if (!fs.existsSync(path.join(root, 'packages/im/zhin/package.json'))) return null;
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = fs.readJsonSync(pkgPath) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const hasZhin =
      pkg.dependencies?.['zhin.js'] ||
      pkg.devDependencies?.['zhin.js'] ||
      pkg.peerDependencies?.['zhin.js'];
    if (!hasZhin) return null;
    return {
      'zhin.js': 'workspace:*',
      '@zhin.js/cli': 'workspace:*',
      '@zhin.js/plugin-runtime': 'workspace:*',
      '@zhin.js/command': 'workspace:*',
      '@zhin.js/adapter': 'workspace:*',
      '@zhin.js/core': 'workspace:*',
    };
  } catch {
    return null;
  }
}

export const newCommand = new Command('new')
  .description('创建约定式插件包模板（Plugin Runtime）')
  .argument('[plugin-name]', '插件名称（如: my-plugin，需匹配 /^[a-z][a-z0-9-]*$/）')
  .option('--is-official', '是否为官方插件', false)
  .option('--skip-install', '跳过依赖安装', false)
  .option('--type <type>', '插件类型 (normal|service|adapter)')
  .action(async (pluginName: string, options: NewPluginOptions) => {
    try {
      let name = pluginName;
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

      // 确定插件目录
      const pluginDir = path.resolve(process.cwd(), 'plugins', name);

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
            type: 'list',
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
      await createPluginPackage(pluginDir, name, options);

      // 自动添加到 app/package.json 并提示挂载方式
      await addPluginToApp(name, options.isOfficial);

      const packageName = options.isOfficial ? `@zhin.js/${name}` : `zhin.js-${name}`;

      logger.success(`✓ 插件包 ${name} 创建成功！`);
      logger.log('');
      logger.log('📝 下一步操作：');
      logger.log('  1. 在 app 的 package.json 的 "zhin.plugins" 数组中添加：');
      logger.log(`     { "package": "${packageName}", "instanceKey": "${name}" }`);
      logger.log('  2. pnpm dev  # 即 zhin runtime start（约定式插件运行时）');
      logger.log('');
      logger.log('📦 发布到 npm（在项目根）：');
      logger.log(`  pnpm exec zhin pub ${name}`);
      logger.log(`  # 或嵌套目录: pnpm exec zhin pub adapters/<适配器名>`);
      logger.log('');
      logger.log('🤖 AI 技能：可编辑 plugins/' + name + '/agent/skills/' + name + '.md（随 npm 包发布）');

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

async function createPluginPackage(pluginDir: string, pluginName: string, options: NewPluginOptions) {
  const kind: PluginKind = options.type ?? 'normal';
  const capitalizedName = toCapitalizedName(pluginName);
  const packageName = options.isOfficial ? `@zhin.js/${pluginName}` : `zhin.js-${pluginName}`;

  await fs.ensureDir(pluginDir);
  await fs.ensureDir(path.join(pluginDir, 'tests'));
  await fs.ensureDir(path.join(pluginDir, 'agent', 'skills'));
  if (kind === 'normal') {
    await fs.ensureDir(path.join(pluginDir, 'commands', `${pluginName}-echo`));
  }
  if (kind === 'adapter') {
    await fs.ensureDir(path.join(pluginDir, 'adapters'));
  }

  const zhinStack =
    tryZhinWorkspaceDevDependencies() ??
    ({
      'zhin.js': 'latest',
      '@zhin.js/cli': 'latest',
      '@zhin.js/plugin-runtime': 'latest',
      '@zhin.js/command': 'latest',
      '@zhin.js/adapter': 'latest',
      '@zhin.js/core': 'latest',
    } satisfies Record<string, string>);

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

  // 运行时真实 import 的包放进 dependencies；zhin.js / cli 仅开发期需要
  const dependencies: Record<string, string> = {
    '@zhin.js/plugin-runtime': zhinStack['@zhin.js/plugin-runtime'],
  };
  if (kind === 'normal') {
    dependencies['@zhin.js/command'] = zhinStack['@zhin.js/command'];
  }
  if (kind === 'adapter') {
    dependencies['@zhin.js/adapter'] = zhinStack['@zhin.js/adapter'];
    dependencies['@zhin.js/core'] = zhinStack['@zhin.js/core'];
  }

  const devDependencies: Record<string, string> = {
    '@types/node': 'latest',
    typescript: 'latest',
    vitest: 'latest',
    rimraf: 'latest',
    'zhin.js': zhinStack['zhin.js'],
    '@zhin.js/cli': zhinStack['@zhin.js/cli'],
  };

  const scripts: Record<string, string> = {
    build: 'tsc',
    clean: 'rimraf lib',
    test: 'vitest run',
    'test:watch': 'vitest',
    // 带 agent/ 的插件发布前必须构建（见 pnpm check:plugin-agent-publish）
    prepublishOnly: 'pnpm run build',
  };

  const files = ['plugin.ts', 'schema.json'];
  if (kind === 'normal') files.push('commands');
  if (kind === 'adapter') files.push('adapters');
  files.push('src', 'agent', 'README.md', 'CHANGELOG.md');

  const features: Array<{ package: string; api: string }> = [];
  if (kind === 'normal') features.push({ package: '@zhin.js/command', api: '^1.0.0' });
  if (kind === 'adapter') features.push({ package: '@zhin.js/adapter', api: '^1.0.0' });

  const packageJson: Record<string, unknown> = {
    name: packageName,
    version: '0.1.0',
    description,
    type: 'module',
    exports: {
      './package.json': './package.json',
    },
    files,
    scripts,
    keywords,
    author: '',
    license: 'MIT',
    dependencies,
    devDependencies,
    publishConfig: { access: 'public', registry: 'https://registry.npmjs.org' },
    engines: { node: '^20.19.0 || >=22.12.0' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      engine: '^1.0.0',
      runtime: 'trusted',
      features,
      plugins: [],
    },
  };

  await fs.writeJson(path.join(pluginDir, 'package.json'), packageJson, { spaces: 2 });

  // schema.json：plugins.<instanceKey> 配置的 JSON Schema；适配器带 name 字段
  const schemaJson: Record<string, unknown> = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties:
      kind === 'adapter'
        ? {
            name: {
              type: 'string',
              default: `${pluginName}-bot`,
              description: 'Endpoint 名称',
            },
          }
        : {},
  };
  await fs.writeJson(path.join(pluginDir, 'schema.json'), schemaJson, { spaces: 2 });

  // tsconfig.json：约定目录（commands/adapters/middlewares）由运行时直接加载，
  // 无需 tsc 编译产物，但纳入 include 以便类型检查。
  const tsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      outDir: './lib',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      types: ['node'],
    },
    include: [
      'src/**/*',
      'plugin.ts',
      ...(kind === 'normal' ? ['commands/**/*'] : []),
      ...(kind === 'adapter' ? ['adapters/**/*'] : []),
    ],
    exclude: ['lib', 'node_modules', 'tests'],
  };
  await fs.writeJson(path.join(pluginDir, 'tsconfig.json'), tsConfig, { spaces: 2 });

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
    const pluginTs = `import { definePlugin, databaseHostToken } from '@zhin.js/plugin-runtime';

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
    const pluginTs = `import { definePlugin } from '@zhin.js/plugin-runtime';

/**
 * 适配器约定插件入口：适配器定义在 adapters/ 目录（defineAdapter），
 * Endpoint 实例配置来自 app 配置 plugins.<instanceKey>（见 schema.json）。
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
    const pluginTs = `import { definePlugin } from '@zhin.js/plugin-runtime';

/**
 * 约定式插件入口（Plugin Runtime）：
 * - commands/ 下的 defineCommand 模块即命令（文件名即命令名，支持 [param:type] 动态段目录）
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
    const commandTs = `import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: '${capitalizedName} 示例命令',
  execute() {
    return '${capitalizedName} 运行中！';
  },
});
`;
    await fs.writeFile(path.join(pluginDir, 'commands', `${pluginName}.ts`), commandTs, 'utf8');

    const echoCommandTs = `import { defineCommand } from '@zhin.js/command';

/**
 * 动态段命令：目录名 [text:string] 声明一个 string 参数。
 * 聊天中发送 \`${pluginName}-echo 你好\` 即可触发，params.text 为「你好」。
 */
export default defineCommand({
  description: '回显一段文本（动态段示例）',
  execute({ params }) {
    return \`你说：\${String(params.text ?? '')}\`;
  },
});
`;
    await fs.writeFile(
      path.join(pluginDir, 'commands', `${pluginName}-echo`, '[text:string].ts'),
      echoCommandTs,
      'utf8',
    );
  }

  if (kind === 'adapter') {
    const adapterTs = `/**
 * Convention entry: discover \`adapters/${pluginName}.ts\` → defineAdapter.
 * 最小形态参考 plugins/adapters/sandbox 与 plugins/adapters/email。
 */
import { defineAdapter, type EndpointInstance } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';

export interface ${capitalizedName}AdapterConfig {
  /** Endpoint 名称（对应 schema.json 的 name 字段） */
  name: string;
  /** 平台凭证等，按实际协议扩展 */
  token?: string;
}

export default defineAdapter<${capitalizedName}AdapterConfig, string>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const gateway = context.use(messageGatewayToken);
    let opened = false;

    /** 入站：平台事件 → 标准消息投递（仅在 open() 之后调用） */
    const admit = async (target: string, content: string, sender?: string): Promise<void> => {
      if (!opened) return;
      await gateway.receive({
        adapter: context.id,
        target,
        content,
        sender,
      });
    };

    const endpoint: EndpointInstance<string> = {
      async start() {
        // TODO: 建立平台连接（WebSocket / Webhook / 轮询），
        // 收到平台消息后调用 admit(target, content, sender) 投递入站。
        void admit;
      },
      open() {
        opened = true;
      },
      close() {
        opened = false;
      },
      async stop() {
        opened = false;
        // TODO: 释放平台连接（需幂等）
      },
      async send({ target, payload }) {
        // TODO: 将 payload 投递到平台 target，返回平台侧消息 ID
        return \`stub-message-id:\${target}:\${typeof payload}\`;
      },
    };
    return endpoint;
  },
});
`;
    await fs.writeFile(path.join(pluginDir, 'adapters', `${pluginName}.ts`), adapterTs, 'utf8');
  }

  const readmeIntro =
    kind === 'adapter'
      ? `${capitalizedName} 适配器（\`zhin new --type adapter\` 生成）：约定式 Plugin Runtime 形态，\`adapters/\` 下的 \`defineAdapter\` 模块即适配器，Endpoint 骨架含 start/open/close/stop/send，入站经 \`messageGatewayToken\` 投递。`
      : kind === 'service'
        ? `${capitalizedName} 服务插件（\`zhin new --type service\` 生成）：\`plugin.ts\` 的 \`setup(context)\` 负责初始化与清理，宿主资源（database/schedule/outbound）经 \`context.resources\` 按需取用。`
        : `${capitalizedName} 普通插件（\`zhin new\` / \`--type normal\` 生成）：\`commands/\` 下的 \`defineCommand\` 模块即命令，含动态段 \`[text:string]\` 示例。`;

  const readmeUse =
    kind === 'adapter'
      ? `在 app 的 \`package.json\` 的 \`zhin.plugins\` 数组中添加（\`instanceKey\` 即实例键，可挂载多实例）：

\`\`\`json
{
  "zhin": {
    "plugins": [
      { "package": "${packageName}", "instanceKey": "${pluginName}" }
    ]
  }
}
\`\`\`

Endpoint 配置写在 \`zhin.config.yml\` 的 \`plugins.${pluginName}\` 下（结构见 \`schema.json\`）：

\`\`\`yaml
plugins:
  ${pluginName}:
    name: ${pluginName}-bot
    token: your-token-here
\`\`\`

然后 \`pnpm dev\`（即 \`zhin runtime start\`）启动。`
      : kind === 'service'
        ? `在 app 的 \`package.json\` 的 \`zhin.plugins\` 数组中添加 \`{ "package": "${packageName}", "instanceKey": "${pluginName}" }\`，然后 \`pnpm dev\`（即 \`zhin runtime start\`）启动。实例配置（如有）写在 \`zhin.config.yml\` 的 \`plugins.${pluginName}\` 下，结构见 \`schema.json\`。`
        : `在 app 的 \`package.json\` 的 \`zhin.plugins\` 数组中添加 \`{ "package": "${packageName}", "instanceKey": "${pluginName}" }\`，然后 \`pnpm dev\`（即 \`zhin runtime start\`）启动。聊天中发送 \`${pluginName}\` 或 \`${pluginName}-echo 你好\` 验证命令。`;

  const readmeContent = `# ${packageName}

${readmeIntro}

## 安装

\`\`\`bash
pnpm add ${packageName}
\`\`\`

## 挂载与使用

${readmeUse}

## 目录约定

- \`plugin.ts\`：插件入口（\`definePlugin\`，package.json \`zhin.entry\` 指向它）
- \`schema.json\`：实例配置（\`plugins.<instanceKey>\`）的 JSON Schema
${kind === 'normal' ? '- `commands/`：命令模块（`defineCommand`），目录段 `[name:type]` 声明动态参数\n' : ''}${kind === 'adapter' ? '- `adapters/`：适配器模块（`defineAdapter`），`create(context)` 返回 Endpoint 实例\n' : ''}- \`agent/skills/\`：AI 技能（随 npm 包发布）
- \`tests/\`：Vitest 运行时契约测试

## AI 技能（agent/skills）

本包包含 \`agent/skills/${pluginName}.md\`。请按实际能力修改 \`description\` / \`tools\` 等 frontmatter。

## 开发

\`\`\`bash
pnpm install
pnpm build   # tsc（src/ 与 plugin.ts；约定目录由运行时直接加载）
pnpm test    # vitest
\`\`\`

在 **本仓库** 根执行 \`zhin new\` 时：若存在 \`pnpm-workspace.yaml\`、\`packages/im/zhin/package.json\`，且根 \`package.json\` 声明了 \`zhin.js\`，模板会将 \`zhin.js\` / \`@zhin.js/*\` 依赖写为 \`workspace:*\`。

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
  await fs.writeFile(path.join(pluginDir, 'agent', 'skills', `${pluginName}.md`), skillMdContent);

  // 创建 CHANGELOG.md
  const changelogContent = `# ${packageName}

## 0.1.0

### Features

- 初始版本
`;

  await fs.writeFile(path.join(pluginDir, 'CHANGELOG.md'), changelogContent);

  // 创建 .gitignore
  const gitignoreContent = `node_modules/
lib/
coverage/
*.log
.DS_Store
`;

  await fs.writeFile(path.join(pluginDir, '.gitignore'), gitignoreContent);

  await generateTestFile(pluginDir, pluginName, capitalizedName, kind);

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
  capitalizedName: string,
  kind: PluginKind,
) {
  const testsDir = path.join(pluginDir, 'tests');
  let testContent: string;

  if (kind === 'adapter') {
    testContent = `import { describe, expect, it } from 'vitest';
import { parseAdapterDefinition } from '@zhin.js/adapter';
import plugin from '../plugin.ts';
import adapter from '../adapters/${pluginName}.ts';

describe('zhin.js-${pluginName}', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('${pluginName}');
  });

  it('brands the convention adapter', () => {
    expect(parseAdapterDefinition(adapter)).toBe(adapter);
  });

  it('creates an endpoint skeleton with lifecycle methods', async () => {
    const endpoint = await adapter.create({
      id: 'root/${pluginName}' as never,
      name: '${pluginName}',
      config: { name: 'test-bot' },
      use: () => ({
        receive: async () => ({ matched: false }),
        send: async () => undefined,
      }),
    } as never);
    expect(typeof endpoint.start).toBe('function');
    expect(typeof endpoint.open).toBe('function');
    expect(typeof endpoint.stop).toBe('function');
    expect(typeof endpoint.send).toBe('function');

    await endpoint.start?.();
    endpoint.open?.();
    await expect(endpoint.send?.({ target: 'c1', payload: 'hi' })).resolves.toBeTruthy();
    await endpoint.stop?.();
  });
});
`;
  } else if (kind === 'service') {
    testContent = `import { describe, expect, it } from 'vitest';
import plugin from '../plugin.ts';

describe('zhin.js-${pluginName}', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('${pluginName}');
  });

  it('setup registers a lifecycle dispose', () => {
    const disposes: Array<() => void> = [];
    const context = {
      config: { get: () => ({}) },
      resources: {
        has: () => false,
        use: () => {
          throw new Error('resource not available in test');
        },
      },
      lifecycle: {
        add: (dispose: () => void) => {
          disposes.push(dispose);
        },
      },
    };
    plugin.setup?.(context as never);
    expect(disposes.length).toBeGreaterThan(0);
  });
});
`;
  } else {
    testContent = `import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import plugin from '../plugin.ts';
import mainCommand from '../commands/${pluginName}.ts';
import echoCommand from '../commands/${pluginName}-echo/[text:string].ts';

describe('zhin.js-${pluginName}', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('${pluginName}');
  });

  it('brands the convention commands', () => {
    expect(parseCommandDefinition(mainCommand)).toBe(mainCommand);
    expect(parseCommandDefinition(echoCommand)).toBe(echoCommand);
  });

  it('main command returns greeting text', async () => {
    const result = await mainCommand.execute({ args: [], params: {}, input: undefined } as never);
    expect(String(result)).toContain('运行中');
  });

  it('echo command echoes the dynamic segment', async () => {
    const result = await echoCommand.execute({
      args: ['你好'],
      params: { text: '你好' },
      input: undefined,
    } as never);
    expect(String(result)).toContain('你好');
  });
});
`;
  }

  await fs.writeFile(path.join(testsDir, `${pluginName}-runtime.test.ts`), testContent);
  logger.success('✓ 测试文件已生成');
}

async function addPluginToApp(pluginName: string, isOfficial?: boolean) {
  try {
    const rootPackageJsonPath = path.resolve(process.cwd(), 'package.json');

    // 检查根 package.json 是否存在
    if (!fs.existsSync(rootPackageJsonPath)) {
      logger.warn(formatCompact( { cmd: 'new', op: 'skip_deps', reason: 'no package.json' }));
      return;
    }

    const packageJson = await fs.readJson(rootPackageJsonPath);
    const packageName = isOfficial ? `@zhin.js/${pluginName}` : `zhin.js-${pluginName}`;

    // 初始化 dependencies
    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }

    // 添加 workspace 依赖
    packageJson.dependencies[packageName] = 'workspace:*';

    // 写回文件
    await fs.writeJson(rootPackageJsonPath, packageJson, { spaces: 2 });

    logger.success(`✓ 已将 ${packageName} 添加到 app 的 dependencies`);
    logger.log('  挂载方式：在 app package.json 的 "zhin.plugins" 数组中添加：');
    logger.log(`    { "package": "${packageName}", "instanceKey": "${pluginName}" }`);
    logger.log('  （约定式运行时不再读取 zhin.config.yml 的插件列表，请手动添加挂载项）');

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
