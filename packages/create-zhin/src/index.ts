#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface InitOptions {
  name?: string;
  config?: 'json' | 'yaml' | 'toml' | 'ts' | 'js';
  runtime?: 'node' | 'bun';
  yes?: boolean;
  httpUsername?: string;
  httpPassword?: string;
}

// 生成随机密码
function generateRandomPassword(length: number = 6): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// 获取当前系统用户名
function getCurrentUsername(): string {
  return os.userInfo().username || 'admin';
}

async function main() {
  const args = process.argv.slice(2);
  
  const options: InitOptions = {
    yes: args.includes('-y') || args.includes('--yes')
  };
  
  const projectNameArg = args.find(arg => !arg.startsWith('-'));
  
  if (options.yes) {
    options.config = 'ts';
    options.runtime = 'node';
    options.httpUsername = getCurrentUsername();
    options.httpPassword = generateRandomPassword(6);
  }
  
  // 检测并安装 pnpm
  await ensurePnpmInstalled();
  
  try {
    let name = projectNameArg;
    
    if (!name) {
      const { projectName: inputName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectName',
          message: '请输入项目名称:',
          default: 'my-zhin-bot',
          validate: (input: string) => {
            if (!input.trim()) return '项目名称不能为空';
            if (!/^[a-zA-Z0-9-_]+$/.test(input)) {
              return '项目名称只能包含字母、数字、横线和下划线';
            }
            return true;
          }
        }
      ]);
      name = inputName;
    }
    
    if (!options.runtime) {
      const { runtime } = await inquirer.prompt([
        {
          type: 'list',
          name: 'runtime',
          message: '选择运行时:',
          choices: [
            { name: 'Node.js (推荐)', value: 'node' },
            { name: 'Bun', value: 'bun' }
          ],
          default: 'node'
        }
      ]);
      options.runtime = runtime;
    }
    
    if (!options.config) {
      const { configFormat } = await inquirer.prompt([
        {
          type: 'list',
          name: 'configFormat',
          message: '选择配置文件格式:',
          choices: [
            { name: 'TypeScript (推荐)', value: 'ts' },
            { name: 'JavaScript', value: 'js' },
            { name: 'YAML', value: 'yaml' },
            { name: 'JSON', value: 'json' }
          ],
          default: 'ts'
        }
      ]);
      options.config = configFormat;
    }
    
    // HTTP 认证配置
    if (!options.httpUsername || !options.httpPassword) {
      console.log('');
      console.log(chalk.blue('🔐 配置 Web 控制台登录信息'));
      
      const defaultUsername = getCurrentUsername();
      const defaultPassword = generateRandomPassword(6);
      
      const httpConfig = await inquirer.prompt([
        {
          type: 'input',
          name: 'username',
          message: 'Web 控制台用户名:',
          default: defaultUsername,
          validate: (input: string) => {
            if (!input.trim()) return '用户名不能为空';
            return true;
          }
        },
        {
          type: 'input',
          name: 'password',
          message: 'Web 控制台密码:',
          default: defaultPassword,
          validate: (input: string) => {
            if (!input.trim()) return '密码不能为空';
            if (input.length < 6) return '密码至少需要 6 个字符';
            return true;
          }
        }
      ]);
      
      options.httpUsername = httpConfig.username;
      options.httpPassword = httpConfig.password;
    }

    if (!name) {
      console.error(chalk.red('项目名称不能为空'));
      process.exit(1);
    }

    const projectPath = path.resolve(process.cwd(), name);
    const realName = path.basename(projectPath);
    
    if (fs.existsSync(projectPath)) {
      console.error(chalk.red(`目录 ${realName} 已存在`));
      process.exit(1);
    }

    console.log(chalk.blue(`正在创建 pnpm workspace 项目 ${realName}...`));
    
    await createWorkspace(projectPath, realName, options);
    
    console.log(chalk.green(`✓ 项目结构创建成功！`));
    console.log('');
    
    console.log(chalk.blue('📦 正在安装依赖...'));
    await installDependencies(projectPath);
    
    console.log('');
    console.log(chalk.green('🎉 项目初始化完成！'));
    console.log('');
    console.log(chalk.blue('🔐 Web 控制台登录信息：'));
    console.log(`  ${chalk.gray('URL:')} ${chalk.cyan('http://localhost:8086')}`);
    console.log(`  ${chalk.gray('用户名:')} ${chalk.cyan(options.httpUsername)}`);
    console.log(`  ${chalk.gray('密码:')} ${chalk.cyan(options.httpPassword)}`);
    console.log(`  ${chalk.yellow('⚠ 登录信息已保存到')} ${chalk.cyan('.env')} ${chalk.yellow('文件')}`);
    console.log('');
    console.log('📝 下一步操作：');
    console.log(`  ${chalk.cyan(`cd ${realName}`)}`);
    console.log(`  ${chalk.cyan('pnpm dev')} ${chalk.gray('# 开发环境启动')}`);
    console.log(`  ${chalk.cyan('pnpm start')} ${chalk.gray('# 生产环境启动')}`);
    console.log(`  ${chalk.cyan('pnpm stop')} ${chalk.gray('# 停止机器人')}`);
    console.log(`  ${chalk.cyan('pnpm build')} ${chalk.gray('# 构建所有插件')}`);
    console.log(`  ${chalk.cyan('zhin new <plugin-name>')} ${chalk.gray('# 创建新插件')}`);
    
    console.log('');
    console.log('📚 相关文档：');
    console.log(`  ${chalk.cyan('https://github.com/zhinjs/zhin')}`);
    console.log(`  ${chalk.cyan('https://zhinjs.github.io')}`);
    
  } catch (error) {
    console.error(chalk.red(`创建项目失败: ${error}`));
    process.exit(1);
  }
}

async function ensurePnpmInstalled() {
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    console.log(chalk.green('✓ 检测到 pnpm 已安装'));
  } catch (error) {
    console.log(chalk.yellow('⚠ 未检测到 pnpm，正在自动安装...'));
    try {
      console.log(chalk.blue('正在执行: npm install -g pnpm'));
      execSync('npm install -g pnpm', { stdio: 'inherit' });
      console.log(chalk.green('✓ pnpm 安装成功！'));
    } catch (installError) {
      console.error(chalk.red('✗ pnpm 安装失败，请手动安装:'));
      console.log(chalk.cyan('  npm install -g pnpm'));
      console.log(chalk.gray('或访问: https://pnpm.io/installation'));
      process.exit(1);
    }
  }
}

async function installDependencies(projectPath: string) {
  try {
    console.log(chalk.gray('执行: pnpm install'));
    execSync('pnpm install', {
      cwd: projectPath,
      stdio: 'inherit'
    });
    console.log(chalk.green('✓ 依赖安装成功！'));
  } catch (error) {
    console.log('');
    console.log(chalk.yellow('⚠ 依赖安装失败'));
    console.log(chalk.gray('你可以稍后手动安装:'));
    console.log(chalk.cyan(`  cd ${path.basename(projectPath)}`));
    console.log(chalk.cyan('  pnpm install'));
  }
}

async function createWorkspace(projectPath: string, projectName: string, options: InitOptions) {
  await fs.ensureDir(projectPath);
  
  // 创建 pnpm-workspace.yaml
  await fs.writeFile(path.join(projectPath, 'pnpm-workspace.yaml'), 
`packages:
  - '.'
  - 'plugins/*'
`);
  
  // 创建根 package.json（同时也是主应用的 package.json）
  await fs.writeJson(path.join(projectPath, 'package.json'), {
    name: `${projectName}`,
    private: true,
    version: '0.1.0',
    type: 'module',
    description: `${projectName} - Zhin.js Workspace`,
    scripts: {
      dev: 'zhin dev',
      start: options.runtime === 'bun' ? 'zhin start --bun' : 'zhin start',
      daemon: options.runtime === 'bun' ? 'zhin start --bun --daemon' : 'zhin start --daemon',
      stop: 'zhin stop',
      build: 'pnpm --filter "./plugins/*" build'
    },
    dependencies: {
      'zhin.js': 'latest',
      '@zhin.js/adapter-process': 'latest',
      '@zhin.js/http': 'latest',
      '@zhin.js/client': 'latest',
      '@zhin.js/console': 'latest'
    },
    devDependencies: {
      '@zhin.js/cli': 'latest',
      '@zhin.js/types': 'latest',
      '@types/node': 'latest',
      '@types/react': 'latest',
      'typescript': 'latest',
      'react': 'latest',
      'react-dom': 'latest',
      'lucide-react': 'latest',
      ...(options.runtime === 'bun' ? { 'bun': 'latest' } : { 'tsx': 'latest' })
    }
  }, { spaces: 2 });
  
  // 创建根 tsconfig.json
  await fs.writeJson(path.join(projectPath, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
      allowSyntheticDefaultImports: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      declaration: true,
      sourceMap: true
    }
  }, { spaces: 2 });
  
  // 创建 app 模块
  await createAppModule(projectPath, projectName, options);
  
  // 创建 plugins 目录
  await fs.ensureDir(path.join(projectPath, 'plugins'));
  await fs.writeFile(path.join(projectPath, 'plugins', '.gitkeep'), '');
  
  // 创建 .gitignore
  await fs.writeFile(path.join(projectPath, '.gitignore'), 
`node_modules/
dist/
lib/
*.log
.env
.env.local
.DS_Store
.zhin.pid
.zhin-dev.pid
data/
`);
  
  // 创建 README.md
  await fs.writeFile(path.join(projectPath, 'README.md'),
`# ${projectName}

使用 Zhin.js 框架创建的 pnpm workspace 项目。

## 📁 项目结构

\`\`\`
${projectName}/
├── src/                 # 应用源代码
│   └── plugins/        # 本地插件
├── client/              # 客户端页面
├── data/                # 数据目录
├── plugins/             # 插件开发目录（独立包）
├── zhin.config.${options.config}    # 配置文件
└── pnpm-workspace.yaml
\`\`\`

## 🚀 快速开始

\`\`\`bash
pnpm dev        # 开发环境
pnpm start      # 生产环境
pnpm stop       # 停止
pnpm build      # 构建所有插件
\`\`\`

## 🔌 插件开发

\`\`\`bash
# 创建新插件
zhin new my-plugin

# 构建插件
pnpm build

# 构建特定插件
pnpm --filter @zhin.js/my-plugin build
\`\`\`

插件创建后会自动添加到 package.json，在配置文件中启用即可：

\`\`\`typescript
export default defineConfig({
  plugins: ['my-plugin']
});
\`\`\`

## 📚 文档

- [官方文档](https://zhinjs.github.io)
- [GitHub](https://github.com/zhinjs/zhin)
`);
}

async function createAppModule(projectPath: string, projectName: string, options: InitOptions) {
  // 创建目录结构（根目录即为应用目录）
  await fs.ensureDir(path.join(projectPath, 'src'));
  await fs.ensureDir(path.join(projectPath, 'src', 'plugins'));
  await fs.ensureDir(path.join(projectPath, 'client'));
  await fs.ensureDir(path.join(projectPath, 'data'));
  
  // 创建 .env 文件
  await fs.writeFile(path.join(projectPath, '.env'),
`# 调试模式
DEBUG=true

# 插件目录
# PLUGIN_DIR=./src/plugins

# HTTP 服务配置（Web 控制台登录信息）
HTTP_USERNAME=${options.httpUsername}
HTTP_PASSWORD=${options.httpPassword}
`);
  
  // app/tsconfig.json
  await fs.writeJson(path.join(projectPath, 'tsconfig.json'), {
    extends: '../tsconfig.json',
    compilerOptions: {
      baseUrl: './src',
      jsx: 'react-jsx',
      jsxImportSource: 'zhin.js',
      noEmit: false,
      types: ['@types/node', '@zhin.js/types', 'zhin.js']
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'data']
  }, { spaces: 2 });
  
  // app/src/index.ts
  await fs.writeFile(path.join(projectPath, 'src', 'index.ts'),
`import { createApp } from 'zhin.js';

async function main() {
  try {
    const app = await createApp();
    await app.start();
    
    const shutdown = async () => {
      await app.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('启动失败:', error);
    process.exit(1);
  }
}

main().catch(console.error);
`);
  
  // app/src/plugins/example.ts
  await fs.writeFile(path.join(projectPath, 'src', 'plugins', 'example.ts'),
`import { useLogger, addCommand, MessageCommand, useContext, onDispose } from 'zhin.js';
import * as path from 'path';

const logger = useLogger();

addCommand(new MessageCommand('hello')
  .action(async (message) => {
    logger.info('Hello command from:', message.$sender.name);
    return '你好！欢迎使用 Zhin.js！';
  })
);

addCommand(new MessageCommand('status')
  .action(() => {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    return [
      '🤖 状态',
      \`运行时间: \${Math.floor(uptime / 60)}分钟\`,
      \`内存: \${(memory.rss / 1024 / 1024).toFixed(2)}MB\`
    ].join('\\n');
  })
);

onDispose(() => {
  logger.info('示例插件已卸载');
});

useContext('web',(web)=>{
  web.addEntry(path.resolve(process.cwd(),'client/index.tsx'))
});
logger.info('示例插件已加载');
`);
  
  // app/client/index.tsx
  await fs.writeFile(path.join(projectPath, 'client', 'index.tsx'),
`import { addPage } from '@zhin.js/client';
import { Home } from 'lucide-react';

function HomePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">欢迎使用 ${projectName}</h1>
      <p className="text-gray-600">
        这是使用 Zhin.js 创建的机器人项目。
      </p>
    </div>
  );
}

addPage({
  key: 'home',
  path: '/home',
  title: '首页',
  icon: <Home className="w-5 h-5" />,
  element: <HomePage />
});
`);
  
  // app/client/tsconfig.json
  await fs.writeJson(path.join(projectPath, 'client', 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      skipLibCheck: true,
      esModuleInterop: true
    }
  }, { spaces: 2 });
  
  // 创建配置文件
  await createConfigFile(projectPath, options.config!);
  
  // .env.example
  await fs.writeFile(path.join(projectPath, '.env.example'),
`# 调试模式
DEBUG=true

# 插件目录
# PLUGIN_DIR=./src/plugins

# HTTP 服务配置
# HTTP_USERNAME=admin
# HTTP_PASSWORD=123456
`);
}

async function createConfigFile(appPath: string, format: string) {
  const configMap: Record<string, [string, string]> = {
    ts: ['zhin.config.ts', 
`import { defineConfig } from 'zhin.js';

export default defineConfig(async (env) => {
  return {
    bots: [{
      name: \`\${process.pid}\`,
      context: 'process'
    }],
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',
      'node_modules',
      'node_modules/@zhin.js'
    ],
    plugins: [
      'adapter-process',
      'http',
      'console',
      'example'
    ],
    http: {
      port: 8086,
      username: env.HTTP_USERNAME,
      password: env.HTTP_PASSWORD,
      base: '/api'
    },
    debug: env.DEBUG === 'true'
  };
});
`],
    js: ['zhin.config.js',
`import { defineConfig } from 'zhin.js';

export default defineConfig(async (env) => {
  return {
    bots: [{
      name: \`\${process.pid}\`,
      context: 'process'
    }],
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',
      'node_modules',
      'node_modules/@zhin.js'
    ],
    plugins: [
      'adapter-process',
      'http',
      'console',
      'example'
    ],
    http: {
      port: 8086,
      username: env.HTTP_USERNAME,
      password: env.HTTP_PASSWORD,
      base: '/api'
    },
    debug: env.DEBUG === 'true'
  };
});
`],
    yaml: ['zhin.config.yml',
`bots:
  - name: \${process.pid}
    context: process

plugin_dirs:
  - ./src/plugins
  - node_modules
  - node_modules/@zhin.js

plugins:
  - adapter-process
  - http
  - console
  - example

http:
  port: 8086
  username: \${HTTP_USERNAME}
  password: \${HTTP_PASSWORD}
  base: /api

debug: false
`],
    json: ['zhin.config.json',
`{
  "bots": [{
    "name": "\${process.pid}",
    "context": "process"
  }],
  "plugin_dirs": [
    "./src/plugins",
    "node_modules",
    "node_modules/@zhin.js"
  ],
  "plugins": [
    "adapter-process",
    "http",
    "console",
    "example"
  ],
  "http": {
    "port": 8086,
    "username": "\${HTTP_USERNAME}",
    "password": "\${HTTP_PASSWORD}",
    "base": "/api"
  },
  "debug": false
}
`]
  };
  
  const [filename, content] = configMap[format] || configMap.ts;
  await fs.writeFile(path.join(appPath, filename), content);
}

main();
