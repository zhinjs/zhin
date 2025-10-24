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
  const databaseEnvVars = options.database ? generateDatabaseEnvVars(options.database) : '';
  await fs.writeFile(path.join(projectPath, '.env'),
`# 调试模式
DEBUG=true

# 插件目录
# PLUGIN_DIR=./src/plugins

# HTTP 服务配置（Web 控制台登录信息）
HTTP_USERNAME=${options.httpUsername}
HTTP_PASSWORD=${options.httpPassword}${databaseEnvVars}
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

  // 创建配置文件
  await createConfigFile(projectPath, options.config!, options);
}