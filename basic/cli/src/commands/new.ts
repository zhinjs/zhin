import { Command } from 'commander';
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

/** my-cool-plugin → myCoolPlugin，用作 Adapters / Contexts 键与 provide name */
function toCamelCaseId(pluginName: string): string {
  return pluginName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * 在本仓库等「含 packages/zhin 的 pnpm workspace」根执行 zhin new 时，对齐 workspace 协议依赖。
 * 仅有 pnpm-workspace.yaml 但无 packages/zhin 时不启用，避免误写 workspace:* 导致 pnpm install 失败。
 */
function tryZhinWorkspaceDevDependencies(): Record<string, string> | null {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))) return null;
  if (!fs.existsSync(path.join(root, 'packages/zhin/package.json'))) return null;
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
      '@zhin.js/client': 'workspace:*',
      '@zhin.js/console': 'workspace:*',
      '@zhin.js/console-types': 'workspace:*',
    };
  } catch {
    return null;
  }
}

export const newCommand = new Command('new')
  .description('创建插件包模板')
  .argument('[plugin-name]', '插件名称（如: my-plugin）')
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
              if (!/^[a-zA-Z0-9-_]+$/.test(input)) {
                return '插件名称只能包含字母、数字、横线和下划线';
              }
              return true;
            }
          }
        ]);
        name = inputName;
      }

      // 确定插件目录
      const pluginDir = path.resolve(process.cwd(), 'plugins', name);
      
      // 检查目录是否已存在
      if (fs.existsSync(pluginDir)) {
        logger.error(`插件目录已存在: ${pluginDir}`);
        process.exit(1);
      }

      // 询问插件类型（未传 --type 时）
      let resolvedType: 'normal' | 'service' | 'adapter' = options.type ?? 'normal';
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

      logger.info(
        `正在创建${options.type === 'service' ? '服务' : options.type === 'adapter' ? '适配器' : '插件'}包 ${name}...`,
      );
      
      // 创建插件包结构
      await createPluginPackage(pluginDir, name, options);
      
      // 自动添加到 app/package.json
      await addPluginToApp(name, options.isOfficial);
      
      const packageName = options.isOfficial ? `@zhin.js/${name}` : `zhin.js-${name}`;
      
      logger.success(`✓ 插件包 ${name} 创建成功！`);
      logger.log('');
      logger.log('📝 下一步操作：');
      logger.log(`  1. 在 zhin.config.yml 的 plugins 列表中添加 "${packageName}"`);
      logger.log(`  2. pnpm dev  # 开发模式（热重载，自动加载插件）`);
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

async function createPluginPackage(pluginDir: string, pluginName: string, options: NewPluginOptions) {
  const kind = options.type ?? 'normal';
  const capitalizedName =
    pluginName.charAt(0).toUpperCase() +
    pluginName.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const camelId = toCamelCaseId(pluginName);
  const serviceCtxName = `${camelId}Service`;
  const packageName = options.isOfficial ? `@zhin.js/${pluginName}` : `zhin.js-${pluginName}`;
  const withClient = kind !== 'service';

  await fs.ensureDir(pluginDir);
  await fs.ensureDir(path.join(pluginDir, 'src'));
  if (withClient) {
    await fs.ensureDir(path.join(pluginDir, 'client'));
    await fs.ensureDir(path.join(pluginDir, 'dist'));
  }
  await fs.ensureDir(path.join(pluginDir, 'lib'));
  await fs.ensureDir(path.join(pluginDir, 'tests'));
  await fs.ensureDir(path.join(pluginDir, 'skills', pluginName));

  const zhinStack =
    tryZhinWorkspaceDevDependencies() ??
    ({
      'zhin.js': 'latest',
      '@zhin.js/cli': 'latest',
      '@zhin.js/client': 'latest',
      '@zhin.js/console': 'latest',
      '@zhin.js/console-types': 'latest',
    } satisfies Record<string, string>);

  const description =
    kind === 'adapter'
      ? `Zhin.js ${capitalizedName} 适配器`
      : kind === 'service'
        ? `Zhin.js ${capitalizedName} 服务`
        : `Zhin.js ${capitalizedName} 插件`;

  const keywords =
    kind === 'adapter'
      ? (['zhin.js', 'adapter', 'bot', pluginName] as string[])
      : kind === 'service'
        ? (['zhin.js', 'service', pluginName] as string[])
        : (['zhin.js', 'plugin', pluginName] as string[]);

  const exportsMap: Record<string, unknown> = {
    '.': {
      types: './lib/index.d.ts',
      development: './src/index.ts',
      import: './lib/index.js',
    },
    './package.json': './package.json',
  };
  if (withClient) {
    exportsMap['./client'] = { import: './dist/index.js' };
  }

  const files = ['src', 'lib', 'skills', 'plugin.yml', 'README.md', 'CHANGELOG.md'];
  if (withClient) files.push('client', 'dist');

  const peerDependencies: Record<string, string> = { 'zhin.js': '>=1.0.0' };
  const peerDependenciesMeta: Record<string, { optional: boolean }> = {};
  if (withClient) {
    peerDependencies['@zhin.js/client'] = '>=1.0.0';
    peerDependencies['@zhin.js/console'] = '>=1.0.0';
    peerDependenciesMeta['@zhin.js/console'] = { optional: true };
  }
  if (kind === 'adapter') {
    peerDependencies['@zhin.js/http'] = '>=1.0.0';
    peerDependenciesMeta['@zhin.js/http'] = { optional: true };
  }

  const devDependencies: Record<string, string> = {
    '@types/node': 'latest',
    typescript: 'latest',
    ...zhinStack,
    vitest: 'latest',
    '@vitest/coverage-v8': 'latest',
    rimraf: 'latest',
  };
  if (withClient) {
    Object.assign(devDependencies, {
      '@types/react': 'latest',
      '@types/react-dom': 'latest',
      react: 'latest',
      'react-dom': 'latest',
    });
  }

  const scripts: Record<string, string> = {
    build: 'zhin build',
    dev: 'tsc --watch',
    clean: withClient ? 'rimraf lib dist' : 'rimraf lib',
    test: 'vitest run',
    'test:watch': 'vitest',
    'test:coverage': 'vitest run --coverage',
    prepublishOnly: 'pnpm build',
  };
  if (withClient) {
    scripts['build:client'] = 'zhin build';
    scripts['dev:client'] = 'zhin build --watch';
  }

  const packageJson: Record<string, unknown> = {
    name: packageName,
    version: '0.1.0',
    description,
    type: 'module',
    main: './lib/index.js',
    types: './lib/index.d.ts',
    exports: exportsMap,
    files,
    scripts,
    keywords,
    author: '',
    license: 'MIT',
    peerDependencies,
    devDependencies,
    publishConfig: { access: 'public', registry: 'https://registry.npmjs.org' },
  };
  if (Object.keys(peerDependenciesMeta).length > 0) {
    packageJson.peerDependenciesMeta = peerDependenciesMeta;
  }

  await fs.writeJson(path.join(pluginDir, 'package.json'), packageJson, { spaces: 2 });

  const pluginYmlDesc =
    kind === 'adapter'
      ? `${capitalizedName} 适配器（zhin new --type adapter）`
      : kind === 'service'
        ? `${capitalizedName} 服务（zhin new --type service）`
        : `${capitalizedName} 插件（zhin new）`;
  const pluginYml = `name: ${pluginName}
description: ${pluginYmlDesc}，请按实际能力修改
version: 0.1.0
`;
  await fs.writeFile(path.join(pluginDir, 'plugin.yml'), pluginYml, 'utf8');

  // 创建 tsconfig.json (服务端主配置)
  const tsConfig = {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "outDir": "./lib",
      "rootDir": "./src",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "allowSyntheticDefaultImports": true,
      "experimentalDecorators": true,
      "emitDecoratorMetadata": true,
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "verbatimModuleSyntax": false,
      "types": ["node"]
    },
    "include": ["src/**/*"],
    "exclude": ["lib", "node_modules", "client"]
  } 
  ;
  
  await fs.writeJson(path.join(pluginDir, 'tsconfig.json'), tsConfig, { spaces: 2 });

  if (withClient) {
    const clientTsConfig = {
      compilerOptions: {
        outDir: '../dist',
        baseUrl: '.',
        declaration: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        target: 'ES2022',
        jsx: 'react-jsx',
        declarationMap: true,
        sourceMap: true,
        skipLibCheck: true,
        noEmit: false,
      },
      include: ['./**/*'],
    };
    await fs.writeJson(path.join(pluginDir, 'client', 'tsconfig.json'), clientTsConfig, { spaces: 2 });
  }

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

  if (kind === 'service') {
    const serviceSrc = `export interface ${capitalizedName}Service {
  /** 占位方法：替换为你的领域 API */
  ping(): string;
}

export function create${capitalizedName}Service(): ${capitalizedName}Service {
  return {
    ping() {
      return 'pong';
    },
  };
}
`;
    await fs.writeFile(path.join(pluginDir, 'src', 'service.ts'), serviceSrc, 'utf8');

    const indexSvc = `import { usePlugin, onDispose, type Context } from 'zhin.js';
import { create${capitalizedName}Service } from './service.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      ${serviceCtxName}: import('./service.js').${capitalizedName}Service;
    }
  }
}

const { provide, logger } = usePlugin();

provide({
  name: '${serviceCtxName}',
  description: '${capitalizedName} 服务（其它插件通过 root.inject(\"${serviceCtxName}\") 使用）',
  value: create${capitalizedName}Service(),
} as unknown as Context<'${serviceCtxName}'>);

onDispose(() => {
  logger.info('${capitalizedName} 服务插件已销毁');
});

logger.info('${capitalizedName} 服务已加载');

export { create${capitalizedName}Service } from './service.js';
export type { ${capitalizedName}Service } from './service.js';
`;
    await fs.writeFile(path.join(pluginDir, 'src', 'index.ts'), indexSvc, 'utf8');
  } else if (kind === 'adapter') {
    const botSrc = `import type { Bot, Message, SendOptions } from 'zhin.js';
import type { ${capitalizedName}Adapter } from './adapter.js';

export interface ${capitalizedName}BotConfig {
  /** 与 zhin.config.yml 中 bots[].name 一致 */
  name: string;
  /** 平台凭证等，按实际协议扩展 */
  token?: string;
}

export class ${capitalizedName}Bot implements Bot<${capitalizedName}BotConfig, Record<string, never>> {
  $id: string;
  $config: ${capitalizedName}BotConfig;
  $connected = false;

  constructor(
    private readonly adapter: ${capitalizedName}Adapter,
    config: ${capitalizedName}BotConfig,
  ) {
    this.$config = config;
    this.$id = config.name;
  }

  $formatMessage(_event: Record<string, never>): Message {
    throw new Error('[${camelId}] 请实现 $formatMessage：将平台事件转为标准 Message');
  }

  async $connect(): Promise<void> {
    this.$connected = true;
    this.adapter.logger.info(\`[${camelId}] bot \${this.$id} 已连接（占位）\`);
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  async $recallMessage(_id: string): Promise<void> {}

  async $sendMessage(options: SendOptions): Promise<string> {
    this.adapter.logger.debug(\`[${camelId}] stub send: \${JSON.stringify(options)}\`);
    return 'stub-message-id';
  }
}
`;
    await fs.writeFile(path.join(pluginDir, 'src', 'bot.ts'), botSrc, 'utf8');

    const adapterSrc = `import { Adapter, type Plugin } from 'zhin.js';
import { ${capitalizedName}Bot } from './bot.js';
import type { ${capitalizedName}BotConfig } from './bot.js';

export class ${capitalizedName}Adapter extends Adapter<${capitalizedName}Bot> {
  constructor(plugin: Plugin, botConfigs: ${capitalizedName}BotConfig[]) {
    super(plugin, '${camelId}' as keyof Plugin.Contexts, botConfigs);
  }

  createBot(config: ${capitalizedName}BotConfig): ${capitalizedName}Bot {
    return new ${capitalizedName}Bot(this, config);
  }
}
`;
    await fs.writeFile(path.join(pluginDir, 'src', 'adapter.ts'), adapterSrc, 'utf8');

    const indexAd = `import { usePlugin, type Plugin, type Context, onDispose } from 'zhin.js';
import path from 'node:path';
import { PageManager } from '@zhin.js/console';
import { ${capitalizedName}Adapter } from './adapter.js';
import type { ${capitalizedName}BotConfig } from './bot.js';

declare module 'zhin.js' {
  interface Adapters {
    ${camelId}: ${capitalizedName}Adapter;
  }
}

const plugin = usePlugin();
const { provide, useContext, logger } = plugin;

function loadBotConfigsFromApp(): ${capitalizedName}BotConfig[] {
  const cfg = plugin.root.inject('config') as { get?: (k: string) => unknown } | undefined;
  const doc = cfg?.get?.('zhin.config.yml') as { bots?: ${capitalizedName}BotConfig[] } | undefined;
  const bots = doc?.bots ?? [];
  return bots.filter((b) => (b as { context?: string }).context === '${camelId}');
}

provide({
  name: '${camelId}',
  description: '${capitalizedName} 适配器（占位，请接入真实协议）',
  mounted: async (p: Plugin) => {
    const configs = loadBotConfigsFromApp();
    if (configs.length === 0) {
      p.logger.warn(
        '[${camelId}] 未在 zhin.config.yml 的 bots 中找到 context: \"${camelId}\" 的项，将以 0 个 Bot 启动',
      );
    }
    const adapter = new ${capitalizedName}Adapter(p, configs);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: ${capitalizedName}Adapter) => {
    await adapter.stop();
  },
} as unknown as Context<'${camelId}'>);

useContext('web', () => {
  PageManager.addEntry({
    id: '${pluginName}',
    development: path.resolve(import.meta.dirname, '../client/index.tsx'),
    production: path.resolve(import.meta.dirname, '../dist/index.js'),
    meta: { name: '${capitalizedName}' },
  });
});

onDispose(() => {
  logger.info('${capitalizedName} 适配器插件已销毁');
});

logger.info('${capitalizedName} 适配器插件已加载');

export { ${capitalizedName}Adapter } from './adapter.js';
export { ${capitalizedName}Bot } from './bot.js';
export type { ${capitalizedName}BotConfig } from './bot.js';
`;
    await fs.writeFile(path.join(pluginDir, 'src', 'index.ts'), indexAd, 'utf8');
  } else {
    const indexNormal = `import {
  usePlugin,
  useContext,
  onDispose,
  ZhinTool,
  MessageCommand,
} from 'zhin.js';
import path from 'node:path';
import { PageManager } from '@zhin.js/console';

const { addCommand, addTool, logger } = usePlugin();

addCommand(
  new MessageCommand('${pluginName}')
    .desc('${capitalizedName} 插件命令')
    .action(() => '${capitalizedName} 运行中！')
);

addTool(
  new ZhinTool('${pluginName}_greet')
    .desc('发送问候消息')
    .tag('${pluginName}')
    .param('name', { type: 'string', description: '要问候的名字' })
    .execute(async ({ name }) => {
      const greeting = name ? \`你好，\${name}！\` : '你好！';
      return { success: true, message: greeting };
    })
);

useContext('web', () => {
  PageManager.addEntry({
    id: '${pluginName}',
    development: path.resolve(import.meta.dirname, '../client/index.tsx'),
    production: path.resolve(import.meta.dirname, '../dist/index.js'),
    meta: { name: '${capitalizedName}' },
  });
});

onDispose(() => {
  logger.info('${capitalizedName} 插件已销毁');
});

logger.info('${capitalizedName} 插件已加载');
`;
    await fs.writeFile(path.join(pluginDir, 'src', 'index.ts'), indexNormal, 'utf8');
  }

  if (withClient) {
    const clientContent = `import type { PluginRegisterHostApi } from '@zhin.js/console-types';
import ${capitalizedName}Page from './pages/${capitalizedName}Page';

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: '/console/plugins/${pluginName}',
    name: '${capitalizedName}',
    element: api.React.createElement(${capitalizedName}Page),
  });
  api.addTool({ id: '${pluginName}', name: '${capitalizedName}', path: '/console/plugins/${pluginName}' });
}

export { ${capitalizedName}Page };
`;
    await fs.writeFile(path.join(pluginDir, 'client', 'index.tsx'), clientContent, 'utf8');

    await fs.ensureDir(path.join(pluginDir, 'client', 'pages'));
    const pageContent = `import { useEffect } from 'react';

export default function ${capitalizedName}Page() {
  useEffect(() => {
    console.log('${capitalizedName} 页面已挂载');
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>${capitalizedName}</h1>
      <p style={{ color: '#666' }}>控制台插件页占位；可按需接入 @zhin.js/client 与宿主样式。</p>
    </div>
  );
}
`;
    await fs.writeFile(path.join(pluginDir, 'client', 'pages', `${capitalizedName}Page.tsx`), pageContent, 'utf8');
  }

  const readmeIntro =
    kind === 'adapter'
      ? `${capitalizedName} 适配器（\`zhin new --type adapter\` 生成），含占位 Bot / Adapter 与控制台入口。`
      : kind === 'service'
        ? `${capitalizedName} 服务插件（\`zhin new --type service\`），通过 \`provide\` 注册 \`${serviceCtxName}\` 上下文。`
        : `${capitalizedName} 普通插件（\`zhin new\` / \`--type normal\`），含命令、工具与控制台页示例。`;

  const readmeUse =
    kind === 'adapter'
      ? `在 \`zhin.config.yml\` 的 \`plugins\` 中加入 \`${packageName}\`，并配置 bots（\`context\` 必须为适配器键 \`${camelId}\`）：

\`\`\`yaml
plugins:
  - ${packageName}
bots:
  - context: ${camelId}
    name: demo-bot
    token: your-token-here
\`\`\`

可选：安装 \`@zhin.js/http\` 以便后续注册 Webhook 路由。控制台页需启用 \`@zhin.js/console\`。`
      : kind === 'service'
        ? `在 \`zhin.config.yml\` 的 \`plugins\` 中加入 \`${packageName}\`。其它插件中通过 \`root.inject(\"${serviceCtxName}\")\` 获取服务实例（类型由模板中的 declare module 提供）。`
        : `在 \`zhin.config.yml\`（或 \`zhin.config.ts\`）的 \`plugins\` 中加入 \`${packageName}\`。若使用控制台页，请启用 \`@zhin.js/console\`。`;

  const readmeContent = `# ${packageName}

${readmeIntro}

## 安装

\`\`\`bash
pnpm add ${packageName}
\`\`\`

## 使用

${readmeUse}

## AI 技能（SKILL.md）

本包包含 \`skills/${pluginName}/SKILL.md\`。请按实际能力修改 \`description\` / \`tools\` 等 frontmatter。

## 开发

\`\`\`bash
pnpm install
pnpm build
pnpm dev
${withClient ? 'pnpm dev:client   # 仅 client 监听\n' : ''}
\`\`\`

在 **本仓库** 根执行 \`zhin new\` 时：若存在 \`pnpm-workspace.yaml\`、\`packages/zhin/package.json\`，且根 \`package.json\` 声明了 \`zhin.js\`，模板会将 \`zhin.js\` / \`@zhin.js/*\` 开发依赖写为 \`workspace:*\`。

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
  const gitignoreContent = `node_modules/
lib/
dist/
coverage/
*.log
.DS_Store
`;
  
  await fs.writeFile(path.join(pluginDir, '.gitignore'), gitignoreContent);
  
  await generateTestFiles(pluginDir, pluginName, capitalizedName, camelId, options);
  
  // 安装依赖
  if (!options.skipInstall) {
    logger.info('正在安装依赖...');
    try {
      execSync('pnpm install', {
        cwd: pluginDir,
        stdio: 'inherit'
      });
      logger.success('✓ 依赖安装成功');
    } catch (error) {
      logger.warn('⚠ 依赖安装失败，请手动执行 pnpm install');
    }
  }
}

/**
 * 生成测试文件
 */
async function generateTestFiles(
  pluginDir: string,
  pluginName: string,
  capitalizedName: string,
  camelId: string,
  options: NewPluginOptions,
) {
  const testsDir = path.join(pluginDir, 'tests');
  const pluginType = options.type ?? 'normal';

  if (pluginType === 'service') {
    await generateServiceTest(testsDir, capitalizedName);
  } else if (pluginType === 'adapter') {
    await generateAdapterTest(testsDir, pluginName, capitalizedName, camelId);
  } else {
    await generatePluginTest(testsDir, pluginName, capitalizedName);
  }
  
  logger.success('✓ 测试文件已生成');
}

/**
 * 生成普通插件测试
 */
async function generatePluginTest(testsDir: string, pluginName: string, capitalizedName: string) {
  const testContent = `import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Plugin } from 'zhin.js'

describe('${capitalizedName} Plugin', () => {
  let plugin: Plugin
  let rootPlugin: Plugin

  beforeEach(async () => {
    rootPlugin = new Plugin('/test/root-plugin.ts')
    plugin = new Plugin('/plugins/${pluginName}/src/index.ts', rootPlugin)
  })

  afterEach(async () => {
    if (plugin && plugin.started) {
      await plugin.stop()
    }
  })

  describe('Plugin Instance', () => {
    it('should create plugin instance', () => {
      expect(plugin).toBeDefined()
      expect(plugin).toBeInstanceOf(Plugin)
    })

    it('should have a non-empty name derived from entry path', () => {
      expect(typeof plugin.name).toBe('string')
      expect(plugin.name.length).toBeGreaterThan(0)
    })

    it('should have parent plugin', () => {
      expect(plugin.parent).toBe(rootPlugin)
    })

    it('should have logger', () => {
      expect(plugin.logger).toBeDefined()
      expect(typeof plugin.logger.info).toBe('function')
    })
  })

  describe('Plugin Lifecycle', () => {
    it('should start successfully', async () => {
      await expect(plugin.start()).resolves.not.toThrow()
      expect(plugin.started).toBe(true)
    })

    it('should stop successfully', async () => {
      await plugin.start()
      await expect(plugin.stop()).resolves.not.toThrow()
      expect(plugin.started).toBe(false)
    })

    it('should emit mounted event on start', async () => {
      const mountedSpy = vi.fn()
      plugin.on('mounted', mountedSpy)
      
      await plugin.start()
      
      expect(mountedSpy).toHaveBeenCalled()
    })

    it('should emit dispose event on stop', async () => {
      const disposeSpy = vi.fn()
      plugin.on('dispose', disposeSpy)
      
      await plugin.start()
      await plugin.stop()
      
      expect(disposeSpy).toHaveBeenCalled()
    })
  })

  describe('Plugin Features', () => {
    it('should register middleware', () => {
      plugin.addMiddleware(async (event, next) => {
        return next()
      })
      
      expect(plugin.middlewares.length).toBeGreaterThan(0)
    })

    it('should execute middleware', async () => {
      const executionOrder: number[] = []
      
      plugin.addMiddleware(async (event, next) => {
        executionOrder.push(1)
        await next()
      })
      
      plugin.addMiddleware(async (event, next) => {
        executionOrder.push(2)
        await next()
      })

      const mockEvent = {
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [],
        $raw: 'test'
      } as any

      await plugin.middleware(mockEvent, async () => {})
      
      expect(executionOrder).toEqual([1, 2])
    })
  })

  describe('Custom Tests', () => {
    // 在这里添加你的自定义测试
    it('should pass custom test', () => {
      expect(true).toBe(true)
    })
  })
})
`;
  
  await fs.writeFile(path.join(testsDir, 'index.test.ts'), testContent);
}

/**
 * 生成服务测试（纯函数 + 工厂，不依赖完整 Bot 运行时）
 */
async function generateServiceTest(testsDir: string, capitalizedName: string) {
  const testContent = `import { describe, it, expect } from 'vitest';
import { create${capitalizedName}Service } from '../src/service.js';

describe('${capitalizedName} service', () => {
  it('ping returns pong', () => {
    const svc = create${capitalizedName}Service();
    expect(svc.ping()).toBe('pong');
  });
});
`;
  await fs.writeFile(path.join(testsDir, 'index.test.ts'), testContent);
}

/** 生成适配器测试（对接模板中的 Adapter / Bot） */
async function generateAdapterTest(
  testsDir: string,
  pluginName: string,
  capitalizedName: string,
  camelId: string,
) {
  const testContent = `import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Plugin } from 'zhin.js';
import { ${capitalizedName}Adapter } from '../src/adapter.js';
import { ${capitalizedName}Bot } from '../src/bot.js';

describe('${capitalizedName} adapter', () => {
  let root: Plugin;
  let plugin: Plugin;

  beforeEach(() => {
    root = new Plugin('/test/root.ts');
    plugin = new Plugin(\`/plugins/${pluginName}/src/index.ts\`, root);
  });

  afterEach(async () => {
    if (plugin?.started) await plugin.stop();
  });

  it('constructs with empty config and correct adapter key', () => {
    const adapter = new ${capitalizedName}Adapter(plugin, []);
    expect(adapter.bots.size).toBe(0);
    expect(String(adapter.name)).toBe('${camelId}');
  });

  it('createBot wires $id from config.name', () => {
    const adapter = new ${capitalizedName}Adapter(plugin, []);
    const bot = adapter.createBot({ name: 'unit-test-bot' });
    expect(bot).toBeInstanceOf(${capitalizedName}Bot);
    expect(bot.$id).toBe('unit-test-bot');
  });
});
`;
  await fs.writeFile(path.join(testsDir, 'index.test.ts'), testContent);
}

async function addPluginToApp(pluginName: string, isOfficial?: boolean) {
  try {
    const rootPackageJsonPath = path.resolve(process.cwd(), 'package.json');
    
    // 检查根 package.json 是否存在
    if (!fs.existsSync(rootPackageJsonPath)) {
      logger.warn('⚠ 未找到根目录 package.json，跳过依赖添加');
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
    
    logger.success(`✓ 已将 ${packageName} 添加到 package.json`);
    
    // 重新安装依赖
    logger.info('正在更新依赖...');
    try {
      execSync('pnpm install', {
        cwd: process.cwd(),
        stdio: 'inherit'
      });
      logger.success('✓ 依赖更新成功');
    } catch (error) {
      logger.warn('⚠ 依赖更新失败，请手动执行 pnpm install');
    }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`⚠ 添加到 package.json 失败: ${errorMessage}`);
    }
}
