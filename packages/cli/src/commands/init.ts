import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';

interface InitOptions {
  name?: string;
  config?: 'json' | 'yaml' | 'toml' | 'ts' | 'js';
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  runtime?: 'node' | 'bun';
  yes?: boolean;
}

export const initCommand = new Command('init')
  .description('初始化新的Zhin机器人项目')
  .argument('[project-name]', '项目名称')
  .option('-c, --config <format>', '配置文件格式 (json|yaml|toml|ts|js)', 'js')
  .option('-p, --package-manager <manager>', '包管理器 (npm|yarn|pnpm)', 'pnpm')
  .option('-r, --runtime <runtime>', '运行时 (node|bun)', 'node')
  .option('-y, --yes', '自动回答所有问题')
  .action(async (projectName: string, options: InitOptions) => {
    if(options.yes) {
      options.config = 'js';
      options.packageManager = 'pnpm';
      options.runtime = 'node';
    }
    try {
      let name = projectName;
      
      if (!name) {
        const {projectName:inputName} = await inquirer.prompt([
          {
            type: 'input',
            name: 'projectName',
            message: '请输入项目名称:',
            default: 'my-zhin-bot',
            validate: (input: string) => {
              if (!input.trim()) {
                return '项目名称不能为空';
              }
              if (!/^[a-zA-Z0-9-_]+$/.test(input)) {
                return '项目名称只能包含字母、数字、横线和下划线';
              }
              return true;
            }
          }
        ]);
        name = inputName;
      }
      if(!options.runtime) {
        const {runtime:inputRuntime} = await inquirer.prompt([
          {
            type: 'list',
            name: 'runtime',
            message: '选择运行时:',
            choices: [
              { name: 'Node.js (推荐)', value: 'node' },
              { name: 'Bun', value: 'bun' }
            ],
            default: options.runtime || 'node'
          },
        ])
        options.runtime=inputRuntime;
      }
      if(!options.packageManager) {
        const {packageManager:inputPackageManager} = await inquirer.prompt([
          {
            type: 'list',
            name: 'packageManager',
            message: '选择包管理器:',
            choices: [
              { name: 'pnpm (推荐)', value: 'pnpm' },
              { name: 'npm', value: 'npm' },
              { name: 'yarn', value: 'yarn' }
            ],
            default: options.packageManager || 'pnpm'
          }
        ])
        options.packageManager=inputPackageManager;
      }
      if(!options.config) {
        const {configFormat:inputConfigFormat} = await inquirer.prompt([
          {
            type: 'list',
            name: 'configFormat',
            message: '选择配置文件格式:',
            choices: [
              { name: 'JavaScript (推荐)', value: 'js' },
              { name: 'TypeScript', value: 'ts' },
              { name: 'YAML', value: 'yaml' },
              { name: 'JSON', value: 'json' },
              { name: 'TOML', value: 'toml' }
            ],
            default: options.config || 'js'
          }
        ]);
        options.config=inputConfigFormat;
      }

      const projectPath = path.resolve(process.cwd(), name);
      const realName=path.basename(projectPath)
      // 检查目录是否已存在
      if (fs.existsSync(projectPath)) {
        logger.error(`目录 ${realName} 已存在`);
        process.exit(1);
      }

      logger.info(`正在创建项目 ${realName}...`);
      
      // 创建项目目录结构
      await createProjectStructure(projectPath, realName, options);
      
      logger.success(`项目 ${realName} 创建成功！`);
      logger.log('');
      logger.log('🎉 下一步操作：');
      logger.log(`  cd ${realName}`);
      
      const installCommand = getInstallCommand(options.packageManager!);
      logger.log(`  ${installCommand} # 安装依赖`);
      
      logger.log(`  npm run dev # 开发环境启动`);
      logger.log(`  npm run build # 构建项目`);
      logger.log(`  npm run start # 生产环境前台启动`);
      logger.log(`  npm run daemon # 生产环境后台启动`);
      logger.log(`  npm run stop # 停止机器人`);
      
      logger.log('');
      logger.log('📚 相关文档：');
      logger.log('  https://github.com/zhinjs/zhin - 项目主页');
      logger.log('  https://zhinjs.github.io - 官方文档');
      
    } catch (error) {
      logger.error(`创建项目失败: ${error}`);
      process.exit(1);
    }
  });

function getInstallCommand(packageManager: string): string {
  switch (packageManager) {
    case 'yarn': return 'yarn install';
    case 'pnpm': return 'pnpm install';
    default: return 'npm install';
  }
}

async function createProjectStructure(projectPath: string, projectName: string, options: InitOptions) {
  // 创建目录结构
  await fs.ensureDir(projectPath);
  await fs.ensureDir(path.join(projectPath, 'src'));
  await fs.ensureDir(path.join(projectPath, 'src', 'plugins'));
  await fs.ensureDir(path.join(projectPath, 'dist'));
  await fs.ensureDir(path.join(projectPath, 'data'));
  
  // 检查是否在工作区中
  const isInWorkspace = await checkIfInWorkspace();
  const versionSuffix = isInWorkspace ? 'workspace:*' : 'latest';
  
  // 创建 package.json
  const packageJson = {
    name: projectName,
    private: true,
    version: '0.1.0',
    description: `${projectName} 机器人`,
    type: 'module',
    main: 'src/index.ts',
    scripts: {
      dev: 'zhin dev',
      start: options.runtime === 'bun' ? 'zhin start --bun' : 'zhin start',
      daemon: options.runtime === 'bun' ? 'zhin start --bun --daemon' : 'zhin start --daemon',
      build: 'zhin build',
      stop: 'zhin stop'
    },
    dependencies: {
      'zhin.js': versionSuffix,
      '@zhin.js/adapter-process': versionSuffix,
      '@zhin.js/http': versionSuffix,
      '@zhin.js/console': versionSuffix
    },
    devDependencies: {
      '@zhin.js/cli': versionSuffix,
      '@zhin.js/types': versionSuffix,
      "@types/node": "latest",
      'typescript': 'latest',
      ...(options.runtime === 'bun' ? {
        'bun': 'latest'
      } : {
        'tsx': 'latest'
      })
    },
    engines: {
      node: '>=18.0.0'
    }
  };
  
  await fs.writeJson(path.join(projectPath, 'package.json'), packageJson, { spaces: 2 });
  
  // 创建 tsconfig.json
  const tsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      outDir: './dist',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
      allowSyntheticDefaultImports: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      declaration: false,
      sourceMap: true,
      baseUrl: './src',
      jsx: 'react-jsx',
      jsxImportSource: 'zhin.js',
      types: [
        '@types/node',
        '@zhin.js/types',
        'zhin.js'
      ]
    },
    include: ['src/**/*'],
    exclude: ['dist', 'node_modules']
  };
  
  await fs.writeJson(path.join(projectPath, 'tsconfig.json'), tsConfig, { spaces: 2 });
  
  // 创建配置文件
  await createConfigFile(projectPath, options.config!);
  
  // 创建主入口文件
  const indexContent = `import { createApp } from 'zhin.js';

// 启动机器人
async function main() {
    try {
        // 异步创建机器人实例 (自动从配置文件加载)
        const app = await createApp();
        await app.start();
        
        // 优雅退出处理
        const shutdown = async (signal: string) => {
          await app.stop();
          process.exit(0);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    } catch (error) {
        // console.error 已替换为注释
        process.exit(1);
    }
}

// 启动应用
main().catch(console.error);
`;
  
  await fs.writeFile(path.join(projectPath, 'src', 'index.ts'), indexContent);
  
  // 创建示例插件
  const pluginContent = `import {
  useLogger,
  onMessage,
  addCommand,
  addMiddleware,
  MessageCommand,
  useContext,
  onDispose,
} from 'zhin.js';

const logger = useLogger();

// 添加命令
addCommand(new MessageCommand('hello')
  .action(async (message) => {
    logger.info('Hello command called by:', message.$sender.name);
    return '你好！欢迎使用 Zhin 机器人框架！';
  })
);

addCommand(new MessageCommand('status')
  .action(() => {
    const uptime = process.uptime() * 1000;
    const memory = process.memoryUsage();
    return [
      '🤖 机器人状态',
      \`⏱️ 运行时间: \${formatTime(uptime)}\`,
      \`📊 内存使用: \${(memory.rss / 1024 / 1024).toFixed(2)}MB\`,
      \`🔧 Node.js: \${process.version}\`
    ].join('\\n');
  })
);

// 添加中间件
addMiddleware(async (message, next) => {
  logger.info(\`收到消息: \${message.$raw}\`);
  await next();
});

// 监听消息
onMessage(async (message) => {
  if (message.$raw.includes('帮助')) {
    await message.$reply('可用命令：hello, status\\n输入命令即可使用！');
  }
});

// 使用 process 上下文
useContext('process', () => {
  logger.info('Process 适配器已就绪，可以在控制台输入消息进行测试');
});

// 插件销毁时的清理
onDispose(() => {
  logger.info('测试插件已销毁');
});

// 工具函数
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return \`\${days}天 \${hours % 24}小时\`;
  if (hours > 0) return \`\${hours}小时 \${minutes % 60}分钟\`;
  if (minutes > 0) return \`\${minutes}分钟 \${seconds % 60}秒\`;
  return \`\${seconds}秒\`;
}

logger.info('测试插件已加载');
`;
  
  await fs.writeFile(path.join(projectPath, 'src', 'plugins', 'test-plugin.ts'), pluginContent);
  
  // 创建 .gitignore
  const gitignoreContent = `# Dependencies
node_modules/

# Production builds
dist/

# Environment variables
.env
.env.local
.env.development
.env.production

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# PID files
.zhin.pid
.zhin-dev.pid

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# nyc test coverage
.nyc_output

# Dependency directories
jspm_packages/

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Microbundle cache
.rpt2_cache/
.rts2_cache_cjs/
.rts2_cache_es/
.rts2_cache_umd/

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# Next.js build output
.next

# Nuxt.js build / generate output
.nuxt
dist

# Gatsby files
.cache/
public

# Storybook build outputs
.out
.storybook-out

# Temporary folders
tmp/
temp/
`;
  
  await fs.writeFile(path.join(projectPath, '.gitignore'), gitignoreContent);
  
  // 创建 README.md
  const readmeContent = `# ${projectName}

使用 Zhin 框架创建的机器人项目。

## 🚀 快速开始

### 安装依赖

\`\`\`bash
${getInstallCommand(options.packageManager!)}
\`\`\`

### 开发环境

\`\`\`bash
npm run dev
\`\`\`

### 生产环境

\`\`\`bash
# 构建项目
npm run build

# 前台启动
npm run start

# 后台启动
npm run daemon
\`\`\`

### 停止机器人

\`\`\`bash
npm run stop
\`\`\`

## 📁 项目结构

\`\`\`
${projectName}/
├── src/
│   ├── index.ts          # 主入口文件
│   └── plugins/          # 插件目录
│       └── test-plugin.ts # 示例插件
├── dist/                 # 构建输出目录
├── data/                 # 数据目录
├── zhin.config.${options.config}     # 配置文件
├── package.json         # 项目配置
└── tsconfig.json        # TypeScript配置
\`\`\`

## ⚙️ 配置

### 机器人配置

编辑 \`zhin.config.${options.config}\` 来配置你的机器人：

${getConfigExample(options.config!)}

## 🔌 插件开发

在 \`src/plugins/\` 目录下创建你的插件文件。参考 \`test-plugin.ts\` 了解插件开发方式。

### 插件示例

\`\`\`typescript
import { usePlugin, useLogger, addCommand } from '@zhin.js/core';

const plugin = usePlugin();
const logger = useLogger();

// 添加命令
addCommand('hello', (message, args) => {
  logger.info('Hello command called:', args);
});
\`\`\`

## 📚 相关链接

- [Zhin 官方文档](https://zhinjs.github.io)
- [插件开发指南](https://zhinjs.github.io/plugins)
- [GitHub 仓库](https://github.com/zhinjs/zhin)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License
`;
  
  await fs.writeFile(path.join(projectPath, 'README.md'), readmeContent);
  
  // 创建 pnpm-workspace.yaml (如果使用 pnpm)
  if (options.packageManager === 'pnpm') {
    const workspaceContent = `packages:
  - '.'
`;
    await fs.writeFile(path.join(projectPath, 'pnpm-workspace.yaml'), workspaceContent);
  }
  
  // 创建环境变量示例文件
  const envExampleContent = `# Zhin Bot 环境变量配置示例
# 复制为 .env 文件并根据需要修改

# 调试模式
DEBUG=true

# 插件目录 (可选)
# PLUGIN_DIR=./src/plugins

# QQ 官方机器人配置（如果使用 QQ 适配器）
# QQ_APPID=your-app-id
# QQ_SECRET=your-secret

# KOOK 机器人配置（如果使用 KOOK 适配器）
# KOOK_TOKEN=your-kook-token

# ICQQ 机器人配置（如果使用 ICQQ 适配器）
# ICQQ_SCAN_UIN=your-qq-number
# ICQQ_LOGIN_UIN=your-qq-number
# ICQQ_PASSWORD=your-password
# ICQQ_SIGN_ADDR=http://localhost:8080

# OneBot 机器人配置（如果使用 OneBot 适配器）
# ONEBOT_NAME=my-bot
# ONEBOT_TOKEN=your-access-token
# ONEBOT_URL=ws://localhost:8080
`;
  await fs.writeFile(path.join(projectPath, '.env.example'), envExampleContent);
}

async function createConfigFile(projectPath: string, format: string) {
  const configContent = getConfigContent(format);
  let fileName: string;
  
  switch (format) {
    case 'ts':
      fileName = 'zhin.config.ts';
      break;
    case 'js':
      fileName = 'zhin.config.ts';
      break;
    default:
      fileName = `zhin.config.${format}`;
  }
  
  await fs.writeFile(path.join(projectPath, fileName), configContent);
}

function getConfigContent(format: string): string {
  switch (format) {
    case 'json':
      return JSON.stringify({
        bots: [
          {
            name: `${process.pid}`,
            context: 'process'
          }
        ],
        plugin_dirs: [
          './src/plugins',
          'node_modules',
          'node_modules/@zhin.js'
        ],
        plugins: [
          'adapter-process',
          'http',
          'console',
          'test-plugin'
        ],
        debug: false
      }, null, 2);
      
    case 'yaml':
      return `# Zhin Bot 配置文件

# 机器人配置
bots:
  - name: \${process.pid}
    context: process

# 插件目录
plugin_dirs:
  - ./src/plugins
  - node_modules
  - node_modules/@zhin.js
# 要加载的插件列表
plugins:
  - adapter-process
  - http
  - console
  - test-plugin

# 调试模式
debug: false
`;
      
    case 'toml':
      return `# Zhin Bot 配置文件

# 机器人配置
[[bots]]
name = "\${process.pid}"
context = "process"

# 插件目录
plugin_dirs = ["./src/plugins", "node_modules", "node_modules/@zhin.js"]

# 要加载的插件列表
plugins = ["adapter-process", "http", "console", "test-plugin"]

# 调试模式
debug = false
`;
      
    case 'ts':
      return `import { defineConfig } from 'zhin.js';
import path from 'node:path';

export default defineConfig(async (env) => {
  return {
    // 数据库配置
    database: {
      dialect: 'sqlite',
      filename: './data/bot.db'
    },
    
    // 机器人配置
    bots: [
      {
        name: \`\${process.pid}\`,
        context: 'process'
      }
    ],
    
    // 插件目录
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',
      'node_modules',
      path.join('node_modules', '@zhin.js')
    ],
    
    // 要加载的插件列表
    plugins: [
      'http',
      'adapter-process',
      'console',
      'test-plugin'
    ],

    // 调试模式
    debug: env.DEBUG === 'true'
  };
});
`;
      
    case 'js':
      return `import { defineConfig } from 'zhin.js';
import path from 'node:path';

export default defineConfig(async (env) => {
  return {
    // 数据库配置
    database: {
      dialect: 'sqlite',
      filename: './data/bot.db'
    },
    
    // 机器人配置
    bots: [
      {
        name: \`\${process.pid}\`,
        context: 'process'
      }
    ],
    
    // 插件目录
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',
      'node_modules',
      path.join('node_modules', '@zhin.js')
    ],
    
    // 要加载的插件列表
    plugins: [
      'http',
      'adapter-process',
      'console',
      'test-plugin'
    ],

    // 调试模式
    debug: env.DEBUG === 'true'
  };
});
`;

    default:
      throw new Error(`不支持的配置格式: ${format}`);
  }
}

function getConfigExample(format: string): string {
  switch (format) {
    case 'json':
      return `\`\`\`json
{
  "bots": [
    {
      "name": "\${process.pid}",
      "context": "process"
    }
  ],
  "plugin_dirs": [
    "./src/plugins",
    "node_modules",
    "node_modules/@zhin.js"
  ],
  "plugins": [
    "adapter-process",
    "http",
    "console",
    "test-plugin"
  ],
  "debug": false
}
\`\`\`
`;
    case 'yaml':
      return `\`\`\`yaml
# Zhin Bot 配置文件

# 机器人配置
bots:
  - name: \${process.pid}
    context: process

# 插件目录
plugin_dirs:
  - ./src/plugins
  - node_modules

# 要加载的插件列表
plugins:
  - adapter-process
  - http
  - console
  - test-plugin

# 调试模式
debug: false
\`\`\`
`;
    case 'toml':
      return `\`\`\`toml
# Zhin Bot 配置文件

# 机器人配置
[[bots]]
name = "\${process.pid}"
context = "process"

# 插件目录
plugin_dirs = ["./src/plugins", "node_modules"]

# 要加载的插件列表
plugins = ["adapter-process", "http", "console", "test-plugin"]

# 调试模式
debug = false
\`\`\`
`;
    case 'ts':
      return `\`\`\`typescript
import { defineConfig } from 'zhin.js';

export default defineConfig(async (env) => {
  return {
    // 机器人配置
    bots: [
      {
        name: \`\${process.pid}\`,
        context: 'process'
      }
    ],
    
    // 插件目录
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',
      'node_modules'
    ],
    
    // 要加载的插件列表
    plugins: [
      'adapter-process',
      'http',
      'console',
      'test-plugin'
    ],

    // 调试模式
    debug: env.DEBUG === 'true'
  };
});
\`\`\`
`;
    case 'js':
      return `\`\`\`javascript
import { defineConfig } from 'zhin.js';

export default defineConfig(async (env) => {
  return {
    // 机器人配置
    bots: [
      {
        name: \`\${process.pid}\`,
        context: 'process'
      }
    ],
    
    // 插件目录
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',
      'node_modules'
    ],
    
    // 要加载的插件列表
    plugins: [
      'adapter-process',
      'http',
      'console',
      'test-plugin'
    ],

    // 调试模式
    debug: env.DEBUG === 'true'
  };
});
\`\`\`
`;
    default:
      throw new Error(`不支持的配置格式: ${format}`);
  }
}

async function checkIfInWorkspace(): Promise<boolean> {
  let currentDir = process.cwd();
  
  while (currentDir !== path.dirname(currentDir)) {
    // 检查 pnpm-workspace.yaml
    const pnpmWorkspacePath = path.join(currentDir, 'pnpm-workspace.yaml');
    if (fs.existsSync(pnpmWorkspacePath)) {
      return true;
    }
    
    // 检查 package.json 中的 workspaces 字段
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = fs.readJsonSync(packageJsonPath);
        if (packageJson.workspaces) {
          return true;
        }
      } catch {
        // 忽略错误，继续向上查找
      }
    }
    
    currentDir = path.dirname(currentDir);
  }
  
  return false;
} 