import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { InitOptions, DATABASE_PACKAGES } from './types.js';
import { createConfigFile, generateDatabaseEnvVars } from './config.js';
import { generateAdapterEnvVars, getAdapterDependencies } from './adapter.js';
import { generateAIEnvVars } from './ai.js';
import { SOUL_MD_TEMPLATE, TOOLS_MD_TEMPLATE, AGENTS_MD_TEMPLATE } from './templates/bootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createWorkspace(projectPath: string, projectName: string, options: InitOptions): Promise<void> {
  await fs.ensureDir(projectPath);
  
  // 创建 pnpm-workspace.yaml (包含 plugins 目录，支持 zhin new 创建的插件)
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
      build: 'tsc && zhin-console build',
      'pm2:start': 'pm2 start ecosystem.config.cjs',
      'pm2:stop': 'pm2 stop ecosystem.config.cjs',
      'pm2:restart': 'pm2 restart ecosystem.config.cjs',
      'pm2:delete': 'pm2 delete ecosystem.config.cjs',
      'pm2:logs': 'pm2 logs',
      'pm2:monit': 'pm2 monit'
    },
    dependencies: {
      'zhin.js': 'latest',
      '@zhin.js/cli': 'latest',
      '@zhin.js/http': 'latest',
      '@zhin.js/client': 'latest',
      '@zhin.js/console': 'latest',
      'tsx': 'latest',
      ...adapterDeps,
      ...databaseDeps
    },
    devDependencies: {
      '@types/node': 'latest',
      '@types/react': 'latest',
      '@types/react-dom': 'latest',
      'typescript': 'latest',
      'lucide-react': 'latest',
      'rimraf': 'latest',
      'pm2': 'latest',
      'vite': 'latest',
      '@vitejs/plugin-react': 'latest',
      '@tailwindcss/vite': 'latest'
    },
    pnpm: {
      onlyBuiltDependencies: ['esbuild']
    },
    engines: {
      node: '>=18.0.0'
    }
  }, { spaces: 2 });
  
  // 创建 app 模块（内部会写入完整的 tsconfig.json）
  await createAppModule(projectPath, projectName, options);
  
  // 创建引导文件（SOUL.md, TOOLS.md, AGENTS.md）
  await fs.writeFile(path.join(projectPath, 'SOUL.md'), SOUL_MD_TEMPLATE);
  await fs.writeFile(path.join(projectPath, 'TOOLS.md'), TOOLS_MD_TEMPLATE);
  await fs.writeFile(path.join(projectPath, 'AGENTS.md'), AGENTS_MD_TEMPLATE);

  // 创建内置技能：skill-creator、summarize
  const skillCreatorDir = path.join(projectPath, 'skills', 'skill-creator');
  await fs.ensureDir(skillCreatorDir);
  const skillCreatorPath = path.join(__dirname, '../template/skills/skill-creator/SKILL.md');
  if (fs.existsSync(skillCreatorPath)) {
    await fs.copy(skillCreatorPath, path.join(skillCreatorDir, 'SKILL.md'));
  }
  const summarizeDir = path.join(projectPath, 'skills', 'summarize');
  await fs.ensureDir(summarizeDir);
  const summarizePath = path.join(__dirname, '../template/skills/summarize/SKILL.md');
  if (fs.existsSync(summarizePath)) {
    await fs.copy(summarizePath, path.join(summarizeDir, 'SKILL.md'));
  }
  const githubDir = path.join(projectPath, 'skills', 'github');
  await fs.ensureDir(githubDir);
  const githubPath = path.join(__dirname, '../template/skills/github/SKILL.md');
  if (fs.existsSync(githubPath)) {
    await fs.copy(githubPath, path.join(githubDir, 'SKILL.md'));
  }

  // 创建插件开发技能（可选）
  if (options.devSkills) {
    const devSkillNames = ['plugin-init', 'plugin-develop', 'plugin-test', 'plugin-quality', 'plugin-publish'];
    for (const skillName of devSkillNames) {
      const skillDir = path.join(projectPath, 'skills', skillName);
      await fs.ensureDir(skillDir);
      const skillSrcPath = path.join(__dirname, '../template/skills', skillName, 'SKILL.md');
      if (fs.existsSync(skillSrcPath)) {
        await fs.copy(skillSrcPath, path.join(skillDir, 'SKILL.md'));
      }
    }
  }
  
  // 创建 plugins 目录
  await fs.ensureDir(path.join(projectPath, 'plugins'));
  await fs.writeFile(path.join(projectPath, 'plugins', '.gitkeep'), '');
  
  // 创建 systemd service 配置（Linux）：当前目录用 npx 启动，不写死 nvm/node 路径
  await fs.writeFile(path.join(projectPath, `${projectName}.service`),
`[Unit]
Description=${projectName} - Zhin.js Bot
After=network.target

[Service]
Type=simple
User=%i
WorkingDirectory=${path.resolve(projectPath)}
ExecStart=/usr/bin/env npx zhin start --daemon
ExecStop=/usr/bin/env npx zhin stop
Restart=always
RestartSec=10s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${projectName}

# 环境变量（确保 PATH 含 node/npx，如 /usr/local/bin）
Environment="NODE_ENV=production"
EnvironmentFile=${path.resolve(projectPath, '.env')}

# 资源限制
LimitNOFILE=65536
MemoryMax=2G

[Install]
WantedBy=multi-user.target
`);

  // 创建 launchd plist 配置（macOS）：当前目录用 npx 启动，不写死 nvm/node 路径
  await fs.writeFile(path.join(projectPath, `com.zhinjs.${projectName}.plist`),
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.zhinjs.${projectName}</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/env</string>
        <string>npx</string>
        <string>zhin</string>
        <string>start</string>
        <string>--daemon</string>
    </array>
    
    <key>WorkingDirectory</key>
    <string>${path.resolve(projectPath)}</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <true/>
    
    <key>StandardOutPath</key>
    <string>${path.resolve(projectPath, 'logs/launchd-stdout.log')}</string>
    
    <key>StandardErrorPath</key>
    <string>${path.resolve(projectPath, 'logs/launchd-stderr.log')}</string>
    
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
`);

  // 创建 Windows NSSM 安装脚本（PowerShell）
  await fs.writeFile(path.join(projectPath, 'install-service.ps1'),
`# Windows 服务安装脚本（使用 NSSM）
# 需要管理员权限运行

$ServiceName = "${projectName}"
$ProjectPath = "${path.resolve(projectPath).replace(/\\/g, '\\\\')}"

# 当前目录使用 npx 启动，不依赖 nvm 等固定 node 路径
$NpxArgs = "zhin start --daemon"

# 检查 NSSM 是否安装
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Host "❌ 未找到 NSSM，请先安装：" -ForegroundColor Red
    Write-Host ""
    Write-Host "方式一：使用 Chocolatey" -ForegroundColor Yellow
    Write-Host "  choco install nssm" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "方式二：使用 Scoop" -ForegroundColor Yellow
    Write-Host "  scoop install nssm" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "方式三：手动下载" -ForegroundColor Yellow
    Write-Host "  https://nssm.cc/download" -ForegroundColor Cyan
    exit 1
}

Write-Host "🔧 安装 Windows 服务: $ServiceName" -ForegroundColor Green

# 停止并删除已存在的服务
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "⚠️  服务已存在，先删除..." -ForegroundColor Yellow
    nssm stop $ServiceName
    nssm remove $ServiceName confirm
}

# 安装服务（npx 在项目目录下启动）
nssm install $ServiceName npx $NpxArgs

# 配置服务
nssm set $ServiceName AppDirectory $ProjectPath
nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production"
nssm set $ServiceName DisplayName "Zhin.js Bot - $ServiceName"
nssm set $ServiceName Description "Zhin.js 聊天机器人服务"
nssm set $ServiceName Start SERVICE_AUTO_START
nssm set $ServiceName AppStdout "$ProjectPath\\logs\\nssm-stdout.log"
nssm set $ServiceName AppStderr "$ProjectPath\\logs\\nssm-stderr.log"
nssm set $ServiceName AppRotateFiles 1
nssm set $ServiceName AppRotateOnline 1
nssm set $ServiceName AppRotateBytes 10485760

Write-Host ""
Write-Host "✅ 服务安装成功！" -ForegroundColor Green
Write-Host ""
Write-Host "📝 管理命令：" -ForegroundColor Yellow
Write-Host "  启动服务: nssm start $ServiceName" -ForegroundColor Cyan
Write-Host "  停止服务: nssm stop $ServiceName" -ForegroundColor Cyan
Write-Host "  重启服务: nssm restart $ServiceName" -ForegroundColor Cyan
Write-Host "  查看状态: nssm status $ServiceName" -ForegroundColor Cyan
Write-Host "  卸载服务: nssm remove $ServiceName confirm" -ForegroundColor Cyan
Write-Host ""
Write-Host "🚀 启动服务：" -ForegroundColor Yellow
Write-Host "  nssm start $ServiceName" -ForegroundColor Cyan
`);

  // 创建 Windows Task Scheduler XML（备选方案）
  await fs.writeFile(path.join(projectPath, `${projectName}-task.xml`),
`<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Zhin.js Bot - ${projectName}</Description>
    <URI>\\${projectName}</URI>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>npx</Command>
      <Arguments>zhin start --daemon</Arguments>
      <WorkingDirectory>${path.resolve(projectPath).replace(/\\/g, '\\\\')}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`);

  // 创建 PM2 配置文件
  await fs.writeFile(path.join(projectPath, 'ecosystem.config.cjs'),
`module.exports = {
  apps: [
    {
      name: '${projectName}',
      script: 'node_modules/.bin/zhin',
      args: 'start',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
    },
  ],
};
`);

  // 创建 .gitignore
  await fs.writeFile(path.join(projectPath, '.gitignore'), 
`node_modules/
dist/
lib/
client/dist/
*.log
logs/
.env
.env.*
!.env.development
!.env.production
.DS_Store
.zhin.pid
.zhin-dev.pid
data/
.pm2/
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

### 开发模式

\`\`\`bash
pnpm dev          # 开发模式（支持热重载）
\`\`\`

### 生产模式

#### 方式一：直接运行

\`\`\`bash
pnpm build        # 构建项目
pnpm start        # 前台运行
pnpm daemon       # 后台运行
pnpm stop         # 停止后台服务
\`\`\`

#### 方式二：系统服务（推荐生产环境，开机自启）

**Linux (systemd)**：

\`\`\`bash
pnpm build                    # 构建项目
zhin install-service          # 安装系统服务
sudo systemctl start ${projectName}.service      # 启动服务
sudo systemctl enable ${projectName}.service     # 开机自启
sudo systemctl status ${projectName}.service     # 查看状态
sudo journalctl -u ${projectName}.service -f     # 查看日志
\`\`\`

**macOS (launchd)**：

\`\`\`bash
pnpm build                    # 构建项目
zhin install-service          # 安装系统服务
launchctl load ~/Library/LaunchAgents/com.zhinjs.${projectName}.plist
launchctl start com.zhinjs.${projectName}
launchctl list | grep ${projectName}
\`\`\`

**Windows (NSSM)**：

\`\`\`powershell
# 1. 安装 NSSM
choco install nssm           # 使用 Chocolatey
# 或 scoop install nssm      # 使用 Scoop

# 2. 构建项目
pnpm build

# 3. 以管理员身份运行 PowerShell
.\\install-service.ps1

# 4. 启动服务
nssm start ${projectName}

# 查看状态
nssm status ${projectName}
\`\`\`

#### 方式三：使用 PM2

\`\`\`bash
pnpm build        # 构建项目
pnpm pm2:start    # 启动 PM2 守护进程
pnpm pm2:stop     # 停止服务
pnpm pm2:restart  # 重启服务
pnpm pm2:logs     # 查看日志
pnpm pm2:monit    # 监控面板
\`\`\`

**PM2 高级用法**：

\`\`\`bash
# 查看进程状态
pm2 status

# 查看详细信息
pm2 show ${projectName}

# 查看实时日志
pm2 logs ${projectName} --lines 100

# 开机自启动
pm2 startup
pm2 save

# 删除进程
pnpm pm2:delete
\`\`\`

## 🛡️ 进程保活方案对比

| 方案 | 平台支持 | 优点 | 缺点 | 推荐场景 |
|------|----------|------|------|----------|
| **系统服务** | Linux, macOS, Windows | • 系统级监督<br>• 开机自启<br>• 无需额外依赖 | • 需要系统权限<br>• 配置稍复杂 | **生产环境首选** |
| **PM2** | 全平台 | • 功能丰富<br>• 监控面板<br>• 集群模式 | • 需要额外依赖<br>• 占用资源 | 多进程管理 |
| **内置守护** | 全平台 | • 轻量简单<br>• 无需依赖 | • 无系统级监督 | 开发/测试环境 |

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

- [官方文档](https://zhin.js.org)
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
`# HTTP 服务配置（Web 控制台 Token 认证）
HTTP_TOKEN=${options.httpToken}${databaseEnvVars}${adapterEnvVars}${aiEnvVars}
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
        '系统状态',
        \`运行时：Node.js \${process.version} | 架构：\${process.arch}\`,
        \`运行时长：\${Time.formatTime(uptime * 1000)}\`,
        \`物理内存：\${formatMemory(memUsage.rss)}\`,
        \`堆内存：\${formatMemory(memUsage.heapUsed)} / \${formatMemory(memUsage.heapTotal)}\`,
        \`系统内存：\${formatMemory(totalmem - freemem)} / \${formatMemory(totalmem)}\`,
      ].join('\\n');
    })
);
addCommand(
  new MessageCommand("send").action(
    (_, result) => result.remaining as MessageElement[]
  )
);
// 注册客户端页面
useContext('web', (web) => {
  const dispose = web.addEntry(
    path.resolve(process.cwd(), "client/index.tsx"));
  return dispose;
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
                <a href="https://zhin.js.org" target="_blank" rel="noopener noreferrer" 
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