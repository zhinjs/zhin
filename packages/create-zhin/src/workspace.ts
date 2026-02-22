import fs from 'fs-extra';
import path from 'path';
import { InitOptions, DATABASE_PACKAGES } from './types.js';
import { createConfigFile, generateDatabaseEnvVars } from './config.js';
import { generateAdapterEnvVars, getAdapterDependencies } from './adapter.js';
import { generateAIEnvVars } from './ai.js';

export async function createWorkspace(projectPath: string, projectName: string, options: InitOptions): Promise<void> {
  await fs.ensureDir(projectPath);
  
  // 创建 pnpm-workspace.yaml (简化版，与 test-bot 一致)
  await fs.writeFile(path.join(projectPath, 'pnpm-workspace.yaml'), 
`packages:
  - '.'
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

  // 根据适配器选择添加依赖
  const adapterDeps: Record<string, string> = {};
  if (options.adapters) {
    const deps = getAdapterDependencies(options.adapters);
    Object.assign(adapterDeps, deps);
  }
  // 确保 sandbox 始终包含
  if (!adapterDeps['@zhin.js/adapter-sandbox']) {
    adapterDeps['@zhin.js/adapter-sandbox'] = 'latest';
  }

  // 创建根 package.json（与 test-bot 结构一致）
  await fs.writeJson(path.join(projectPath, 'package.json'), {
    name: projectName,
    private: true,
    version: '0.1.0',
    type: 'module',
    description: `${projectName} - Zhin.js Bot`,
    main: 'src/index.ts',
    scripts: {
      dev: 'zhin dev',
      start: 'zhin start',
      daemon: 'zhin start --daemon',
      stop: 'zhin stop',
      build: 'tsc && zhin-console build'
    },
    dependencies: {
      'zhin.js': 'latest',
      "@zhin.js/types": "latest",
      '@zhin.js/http': 'latest',
      '@zhin.js/client': 'latest',
      '@zhin.js/console': 'latest',
      ...adapterDeps,
      ...databaseDeps
    },
    devDependencies: {
      '@zhin.js/cli': 'latest',
      '@types/node': 'latest',
      '@types/react': 'latest',
      '@types/react-dom': 'latest',
      'typescript': 'latest',
      'lucide-react': 'latest',
      'tsx': 'latest',
      'rimraf': 'latest'
    },
    pnpm: {
      onlyBuiltDependencies: ['esbuild', 'sqlite3']
    },
    engines: {
      node: '>=18.0.0'
    }
  }, { spaces: 2 });
  
  // 创建 app 模块（内部会写入完整的 tsconfig.json）
  await createAppModule(projectPath, projectName, options);
  
  // 创建 plugins 目录
  await fs.ensureDir(path.join(projectPath, 'plugins'));
  await fs.writeFile(path.join(projectPath, 'plugins', '.gitkeep'), '');
  
  // 创建 .gitignore
  await fs.writeFile(path.join(projectPath, '.gitignore'), 
`node_modules/
dist/
lib/
client/dist/
*.log
.env
.env.*
!.env.development
!.env.production
.DS_Store
.zhin.pid
.zhin-dev.pid
data/
`);
  
  // 创建 README.md（参考 test-bot 的简洁风格）
  await fs.writeFile(path.join(projectPath, 'README.md'),
`# ${projectName}

使用 Zhin.js 框架创建的机器人项目。

## 📁 项目结构

\`\`\`
${projectName}/
├── src/
│   └── plugins/           # 插件目录
│       └── example.ts     # 示例插件
├── client/                # 客户端页面
│   ├── index.tsx          # 客户端入口
│   └── tsconfig.json      # 客户端配置
├── data/                  # 数据目录（自动生成）
├── zhin.config.${options.config}     # 配置文件
├── package.json
├── tsconfig.json
└── pnpm-workspace.yaml
\`\`\`

## 🚀 快速开始

\`\`\`bash
# 开发模式
pnpm dev

# 生产模式
pnpm start

# 后台运行
pnpm daemon

# 停止服务
pnpm stop

# 构建项目
pnpm build
\`\`\`

## 🔌 插件开发

### 编辑现有插件

直接编辑 \`src/plugins/example.ts\`，支持热重载。

### 创建新插件

在 \`src/plugins/\` 目录下创建新的 \`.ts\` 文件：

\`\`\`typescript
import { usePlugin, MessageCommand } from 'zhin.js';

const { addCommand } = usePlugin();

addCommand(
  new MessageCommand('hello')
    .desc('打招呼')
    .action(() => {
      return '你好！';
    })
);
\`\`\`

### 配置插件

在 \`zhin.config.${options.config}\` 中启用插件：

\`\`\`${options.config === 'json' ? 'json' : options.config === 'toml' ? 'toml' : 'yaml'}
plugins:
  - "@zhin.js/adapter-sandbox"
  - "@zhin.js/http"
  - "@zhin.js/console"
  - example  # 你的插件名称
\`\`\`

## 📚 文档

- [官方文档](https://zhinjs.github.io)
- [GitHub](https://github.com/zhinjs/zhin)

## 许可证

MIT License
`);
}

async function createAppModule(projectPath: string, projectName: string, options: InitOptions): Promise<void> {
  // 创建目录结构（与 test-bot 一致，不需要 src/index.ts）
  await fs.ensureDir(path.join(projectPath, 'src', 'plugins'));
  await fs.ensureDir(path.join(projectPath, 'client'));
  await fs.ensureDir(path.join(projectPath, 'data'));
  
  // 创建 .env 文件（使用简单的变量名，与 test-bot 一致）
  const databaseEnvVars = options.database ? generateDatabaseEnvVars(options.database) : '';
  const adapterEnvVars = options.adapters ? generateAdapterEnvVars(options.adapters) : '';
  const aiEnvVars = options.ai ? generateAIEnvVars(options.ai) : '';
  await fs.writeFile(path.join(projectPath, '.env'),
`# HTTP 服务配置（Web 控制台登录信息）
username=${options.httpUsername}
password=${options.httpPassword}${databaseEnvVars}${adapterEnvVars}${aiEnvVars}
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
  
  // tsconfig.json（与 test-bot 一致）
  await fs.writeJson(path.join(projectPath, 'tsconfig.json'), {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "outDir": "./lib",
      "rootDir": "src",
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
      "jsx": "react-jsx",
      "jsxImportSource": "zhin.js",
      "types": [
        "@types/node",
        "@zhin.js/types",
        "zhin.js",
        "@zhin.js/console",
        "@zhin.js/client",
        "@zhin.js/http"
      ]
    },
    "include": [
      "src/**/*"
    ],
    "exclude": [
      "lib",
      "node_modules"
    ]
  }, { spaces: 2 });
  
  // src/plugins/example.ts（参考 test-bot 的风格）
  await fs.writeFile(path.join(projectPath, 'src', 'plugins', 'example.ts'),
`import { usePlugin, MessageCommand, Time } from 'zhin.js';
import * as os from 'node:os';
import * as path from 'node:path';

const { addCommand, useContext } = usePlugin();

// 格式化内存大小
function formatMemory(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let index = 0;
  while (size > 1024 && index < sizes.length - 1) {
    size = size / 1024;
    index++;
  }
  return \`\${size.toFixed(2)}\${sizes[index]}\`;
}

// Hello 命令
addCommand(
  new MessageCommand('hello')
    .desc('打招呼', '向机器人打招呼')
    .usage('hello')
    .action(() => {
      return '你好！欢迎使用 Zhin.js！';
    })
);

// 状态命令
addCommand(
  new MessageCommand('status')
    .desc('查看系统状态', '显示机器人的运行状态信息')
    .usage('status')
    .action(() => {
      const memUsage = process.memoryUsage();
      const uptime = process.uptime();
      const totalmem = os.totalmem();
      const freemem = os.freemem();
      
      return [
        '╔═══════════ 系统状态 ═══════════╗',
        '',
        \`运行时：Node.js \${process.version} | 架构：\${process.arch}\`,
        \`运行时长：\${Time.formatTime(uptime * 1000)}\`,
        '',
        \`物理内存：\${formatMemory(memUsage.rss)}\`,
        \`堆内存：\${formatMemory(memUsage.heapUsed)} / \${formatMemory(memUsage.heapTotal)}\`,
        '',
        \`系统内存：\${formatMemory(totalmem - freemem)} / \${formatMemory(totalmem)}\`,
        '',
        '╚════════════════════════════════╝'
      ].join('\\n');
    })
);

// 注册客户端页面
useContext('web', (web) => {
  const isDev = process.env.NODE_ENV === 'development';
  const clientEntry = isDev 
    ? './client/index.tsx'
    : './dist/index.js';
  web.addEntry(path.join(process.cwd(), clientEntry));
});
`);
  
  // client/index.tsx（参考 test-bot 的简洁风格）
  await fs.writeFile(path.join(projectPath, 'client', 'index.tsx'),
`import { addPage } from '@zhin.js/client';
import { Home } from 'lucide-react';

function HomePage() {
  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">
          🤖 欢迎使用 Zhin.js
        </h1>
        <p className="text-gray-600 mb-6">
          现代化的 TypeScript 机器人框架
        </p>
        
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-xl font-semibold mb-2">🚀 快速开始</h2>
            <ul className="space-y-1 text-gray-600">
              <li>• 编辑插件: <code className="bg-gray-100 px-2 py-1 rounded">src/plugins/example.ts</code></li>
              <li>• 修改配置: <code className="bg-gray-100 px-2 py-1 rounded">zhin.config.${options.config}</code></li>
              <li>• 查看日志: 控制台输出</li>
            </ul>
          </div>
          
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-xl font-semibold mb-2">📚 资源</h2>
            <ul className="space-y-1">
              <li>
                <a href="https://zhinjs.github.io" target="_blank" rel="noopener noreferrer" 
                   className="text-blue-600 hover:underline">
                  官方文档
                </a>
              </li>
              <li>
                <a href="https://github.com/zhinjs/zhin" target="_blank" rel="noopener noreferrer"
                   className="text-blue-600 hover:underline">
                  GitHub
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

  // client/tsconfig.json
  await fs.writeJson(path.join(projectPath, 'client', 'tsconfig.json'), {
    "compilerOptions": {
      "outDir": "../dist",
      "baseUrl": ".",
      "declaration": true,
      "module": "ESNext",
      "moduleResolution": "bundler",
      "target": "ES2022",
      "jsx": "react-jsx",
      "jsxImportSource": "zhin.js",
      "declarationMap": true,
      "sourceMap": true,
      "skipLibCheck": true,
      "noEmit": false
    },
    "include": [
      "./**/*"
    ]
  }, { spaces: 2 });

  // 创建配置文件
  await createConfigFile(projectPath, options.config!, options);
}