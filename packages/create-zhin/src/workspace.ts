import fs from 'fs-extra';
import path from 'path';
import { InitOptions, DATABASE_PACKAGES } from './types.js';
import { createConfigFile, generateDatabaseEnvVars } from './config.js';

export async function createWorkspace(projectPath: string, projectName: string, options: InitOptions) {
  await fs.ensureDir(projectPath);
  
  // 创建 pnpm-workspace.yaml
  await fs.writeFile(path.join(projectPath, 'pnpm-workspace.yaml'), 
`packages:
  - '.'
  - 'plugins/*'
`);
  
  // 根据数据库类型添加相应依赖
  const databaseDeps: Record<string, string> = {};
  if (options.database) {
    const dbPackage = DATABASE_PACKAGES[options.database.dialect];
    if (dbPackage) {
      databaseDeps[dbPackage] = 'latest';
    }
    // 总是添加数据库包
    databaseDeps['@zhin.js/database'] = 'latest';
  }

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
      '@zhin.js/console': 'latest',
      ...databaseDeps
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
.env.*
.DS_Store
.zhin.pid
.zhin-dev.pid
data/
`);
  
  // 创建 README.md
  await fs.writeFile(path.join(projectPath, 'README.md'),
`# ${projectName}

使用 Zhin.js 框架创建的机器人项目。

## 📁 项目结构

\`\`\`
${projectName}/                  # 根目录（项目主模块）
├── src/                        # 应用源代码
│   ├── index.ts               # 入口文件
│   └── plugins/               # 本地插件（简单插件）
│       └── example.ts         # 示例插件
│
├── client/                     # 客户端页面
│   ├── index.tsx              # 客户端入口
│   └── tsconfig.json          # 客户端 TS 配置
│
├── plugins/                    # 插件模块（独立包）
│   └── my-plugin/             # 使用 zhin new 创建的插件
│       ├── src/               # 插件源码
│       ├── client/            # 插件客户端
│       ├── lib/               # 构建输出
│       ├── package.json       # 插件包配置
│       └── tsconfig.json      # 插件 TS 配置
│
├── data/                       # 数据目录（自动生成）
├── zhin.config.${options.config}         # 机器人配置文件
├── package.json                # 项目依赖配置
├── pnpm-workspace.yaml         # Workspace 配置
└── tsconfig.json               # TypeScript 配置
\`\`\`

## 🎯 项目模块说明

### 根目录（项目主模块）
- 作为主应用程序模块
- 包含机器人的核心代码和简单插件
- \`src/plugins/\` 下的插件直接被加载，适合简单功能

### plugins 目录（插件模块）
- 存放使用 \`zhin new\` 命令创建的独立插件包
- 每个插件都是独立的 npm 包，有自己的 \`package.json\`
- 适合复杂功能、可复用的插件
- 可以独立发布到 npm

## 🚀 快速开始

\`\`\`bash
pnpm dev        # 开发环境（自动监听文件变化）
pnpm start      # 生产环境
pnpm daemon     # 后台运行
pnpm stop       # 停止后台服务
\`\`\`

## 📦 安装插件

### 安装 npm 插件

\`\`\`bash
# 交互式安装
zhin install

# 安装官方插件
zhin install @zhin.js/plugin-name

# 安装第三方插件
zhin add third-party-plugin

# 安装到 devDependencies
zhin install plugin-name -D
\`\`\`

### 安装 Git 插件

\`\`\`bash
# GitHub 简写（推荐）
zhin install username/repo

# 完整 GitHub URL
zhin install https://github.com/username/repo.git

# GitLab
zhin install https://gitlab.com/username/repo.git

# 其他 Git 仓库
zhin install git+https://example.com/repo.git

# 指定分支或标签
zhin install username/repo#branch-name
zhin install username/repo#v1.0.0
\`\`\`

## 🔌 插件开发

### 简单插件（src/plugins/）

直接在 \`src/plugins/\` 下创建 \`.ts\` 文件，会自动被加载：

\`\`\`bash
# 创建简单插件
echo 'import { addCommand } from "zhin.js";
addCommand("test").action(() => "测试成功");
' > src/plugins/test.ts
\`\`\`

### 独立插件（plugins/）

使用 CLI 创建独立的插件包：

\`\`\`bash
# 创建新插件包
zhin new my-plugin

# 进入插件目录
cd plugins/my-plugin

# 开发插件
pnpm dev

# 构建插件
pnpm build
\`\`\`

插件创建后会自动添加到根 package.json 的依赖中。

### 启用插件

在 \`zhin.config.${options.config}\` 中启用插件：

\`\`\`typescript
export default defineConfig({
  plugins: [
    'http',          // 官方插件
    'console',       // 官方插件
    'my-plugin'      // 你的插件
  ]
});
\`\`\`

### 构建所有插件

\`\`\`bash
pnpm build        # 构建 plugins/ 下的所有插件
\`\`\`

### 发布插件到 npm

\`\`\`bash
# 发布插件（会自动构建）
zhin pub my-plugin

# 发布指定插件
zhin pub my-plugin --access public

# 试运行（不实际发布）
zhin pub my-plugin --dry-run

# 跳过构建步骤
zhin pub my-plugin --skip-build

# 发布到自定义 registry
zhin pub my-plugin --registry https://registry.example.com
\`\`\`

发布选项：
- \`--access <public|restricted>\` - 访问级别（默认: public）
- \`--tag <tag>\` - 发布标签（默认: latest）
- \`--registry <url>\` - 自定义 npm registry
- \`--dry-run\` - 试运行，不实际发布
- \`--skip-build\` - 跳过构建步骤

## 📚 文档

- [官方文档](https://zhinjs.github.io)
- [插件开发指南](https://zhinjs.github.io/plugin/)
- [GitHub](https://github.com/zhinjs/zhin)

## 💡 提示

- **src/plugins/** - 适合简单的、项目专用的插件
- **plugins/** - 适合复杂的、可复用的、需要独立发布的插件
- 两种插件可以并存，根据需求选择合适的方式
`);
}

async function createAppModule(projectPath: string, projectName: string, options: InitOptions) {
  // 创建目录结构（根目录即为应用目录）
  await fs.ensureDir(path.join(projectPath, 'src'));
  await fs.ensureDir(path.join(projectPath, 'src', 'plugins'));
  await fs.ensureDir(path.join(projectPath, 'client'));
  await fs.ensureDir(path.join(projectPath, 'data'));
  
  // 创建 .env 文件
  const databaseEnvVars = options.database ? generateDatabaseEnvVars(options.database) : '';
  await fs.writeFile(path.join(projectPath, '.env'),
`# 插件目录

# HTTP 服务配置（Web 控制台登录信息）
HTTP_USERNAME=${options.httpUsername}
HTTP_PASSWORD=${options.httpPassword}${databaseEnvVars}
`);
await fs.writeFile(path.join(projectPath, '.env.development'),
`# 调试模式
DEBUG=true
NODE_ENV=development
`);
await fs.writeFile(path.join(projectPath, '.env.production'),
`# 调试模式
DEBUG=false
NODE_ENV=production
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
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            🤖 欢迎使用 Zhin.js
          </h1>
          <p className="text-lg text-gray-600">
            现代化的 TypeScript 机器人框架
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-3">🚀 快速开始</h2>
            <ul className="space-y-2 text-gray-600">
              <li>• 创建插件: <code className="bg-gray-100 px-2 py-1 rounded">zhin new my-plugin</code></li>
              <li>• 编辑配置: 修改 <code className="bg-gray-100 px-2 py-1 rounded">zhin.config.ts</code></li>
              <li>• 查看日志: <code className="bg-gray-100 px-2 py-1 rounded">pnpm dev</code></li>
            </ul>
          </div>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-3">📚 文档链接</h2>
            <ul className="space-y-2">
              <li>
                <a href="https://zhinjs.github.io" target="_blank" rel="noopener noreferrer" 
                   className="text-blue-600 hover:text-blue-800">
                  官方文档
                </a>
              </li>
              <li>
                <a href="https://github.com/zhinjs/zhin" target="_blank" rel="noopener noreferrer"
                   className="text-blue-600 hover:text-blue-800">
                  GitHub 仓库
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

addPage({
  key: 'home',
  path: '/',
  title: '首页',
  icon: <Home className="w-5 h-5" />,
  element: <HomePage />
});
`);

  // app/client/tsconfig.json
  await fs.writeJson(path.join(projectPath, 'client', 'tsconfig.json'), {
    extends: '@zhin.js/console/browser.tsconfig.json',
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      baseUrl: '.'
    }
  }, { spaces: 2 });

  // 创建配置文件
  await createConfigFile(projectPath, options.config!, options);
}