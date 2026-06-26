import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DATABASE_PACKAGES,
  generateAdapterEnvVars,
  generateAIEnvVars,
  getAdapterDependencies,
  getAIDependencies,
  getCreateBotBaseDependencies,
  DEFAULT_CREATE_BOT_HTTP_PORT,
  CREATE_BOT_NPMRC,
  getCreateBotPnpmConfig,
  type InitOptions,
  ZHIN_STACK_VERSIONS,
} from '@zhin.js/scaffold-wizard';
import { createConfigFile, generateDatabaseEnvVars } from './config.js';
import { SOUL_MD_TEMPLATE, TOOLS_MD_TEMPLATE, AGENTS_MD_TEMPLATE, ASSISTANT_PROFILE_YML_EXAMPLE } from './templates/bootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BASE_SKILL_NAMES = ['skill-creator', 'summarize', 'github'] as const;
export const DEV_SKILL_NAMES = ['plugin-init', 'plugin-develop', 'plugin-test', 'plugin-quality', 'plugin-publish'] as const;

async function copySkillTemplate(projectPath: string, skillName: string): Promise<void> {
  const skillDir = path.join(projectPath, 'skills', skillName);
  const skillSrcPath = path.join(__dirname, '../template/skills', skillName, 'SKILL.md');
  if (!fs.existsSync(skillSrcPath)) {
    throw new Error(`Missing create-zhin skill template: ${skillName}`);
  }
  await fs.ensureDir(skillDir);
  await fs.copy(skillSrcPath, path.join(skillDir, 'SKILL.md'));
}

function getConfigFilename(format: InitOptions['config']): string {
  switch (format) {
    case 'json':
      return 'zhin.config.json';
    case 'toml':
      return 'zhin.config.toml';
    case 'yaml':
    default:
      return 'zhin.config.yml';
  }
}

export async function createWorkspace(projectPath: string, projectName: string, options: InitOptions): Promise<void> {
  const configFilename = getConfigFilename(options.config);
  const configLanguage = options.config === 'json' ? 'json' : options.config === 'toml' ? 'toml' : 'yaml';

  await fs.ensureDir(projectPath);
  
  await fs.writeFile(path.join(projectPath, '.npmrc'), CREATE_BOT_NPMRC);
  
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
      databaseDeps[dbPackage] = '^2.0.0';
    }
    // 总是添加数据库包
    databaseDeps['@zhin.js/database'] = ZHIN_STACK_VERSIONS['@zhin.js/database'];
  }

  // 根据适配器选择添加依赖
  const adapterDeps: Record<string, string> = {};
  if (options.adapters) {
    const deps = getAdapterDependencies(options.adapters);
    Object.assign(adapterDeps, deps);
  }
  // 确保 sandbox 始终包含
  if (!adapterDeps['@zhin.js/adapter-sandbox']) {
    adapterDeps['@zhin.js/adapter-sandbox'] = ZHIN_STACK_VERSIONS['@zhin.js/adapter-sandbox'];
  }

  // AI 启用时预装 MCP SDK
  const aiDeps = getAIDependencies(options.ai);

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
      build: 'zhin build',
      'pm2:start': 'pm2 start ecosystem.config.cjs',
      'pm2:stop': 'pm2 stop ecosystem.config.cjs',
      'pm2:restart': 'pm2 restart ecosystem.config.cjs',
      'pm2:delete': 'pm2 delete ecosystem.config.cjs',
      'pm2:logs': 'pm2 logs',
      'pm2:monit': 'pm2 monit'
    },
    dependencies: {
      ...getCreateBotBaseDependencies(),
      'tsx': '^4.22.0',
      ...adapterDeps,
      ...databaseDeps,
      ...aiDeps
    },
    devDependencies: {
      '@types/node': '^25.0.0',
      '@types/react': '^19.0.0',
      '@types/react-dom': '^19.0.0',
      'typescript': '^6.0.0',
      'rimraf': '^6.0.0',
      'pm2': '^6.0.0',
      'vite': '^6.0.0',
      '@vitejs/plugin-react': '^4.0.0',
      '@tailwindcss/vite': '^4.0.0'
    },
    pnpm: getCreateBotPnpmConfig(options.ai?.enabled),
    engines: {
      node: '^20.19.0 || >=22.12.0'
    }
  }, { spaces: 2 });
  
  // 创建 app 模块（内部会写入完整的 tsconfig.json）
  await createAppModule(projectPath, projectName, options);
  
  // 创建引导文件（SOUL.md, TOOLS.md, AGENTS.md）
  await fs.writeFile(path.join(projectPath, 'SOUL.md'), SOUL_MD_TEMPLATE);
  await fs.writeFile(path.join(projectPath, 'TOOLS.md'), TOOLS_MD_TEMPLATE);
  await fs.writeFile(path.join(projectPath, 'AGENTS.md'), AGENTS_MD_TEMPLATE);
  await fs.writeFile(path.join(projectPath, 'assistant.profile.yml.example'), ASSISTANT_PROFILE_YML_EXAMPLE);

  // 创建内置技能
  for (const skillName of BASE_SKILL_NAMES) {
    await copySkillTemplate(projectPath, skillName);
  }

  // 创建插件开发技能（可选）
  if (options.devSkills) {
    for (const skillName of DEV_SKILL_NAMES) {
      await copySkillTemplate(projectPath, skillName);
    }
  }
  
  // 创建 plugins 目录
  await fs.ensureDir(path.join(projectPath, 'plugins'));
  await fs.writeFile(path.join(projectPath, 'plugins', '.gitkeep'), '');
  
  // 创建 systemd service 配置（Linux）：当前目录用 npx 启动，不写死 nvm/node 路径
  await fs.writeFile(path.join(projectPath, `${projectName}.service`),
`[Unit]
Description=${projectName} - Zhin.js Endpoint
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
nssm set $ServiceName DisplayName "Zhin.js Endpoint - $ServiceName"
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
    <Description>Zhin.js Endpoint - ${projectName}</Description>
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
!.env.example
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
├── ${configFilename}     # 配置文件
├── package.json
├── tsconfig.json
└── pnpm-workspace.yaml
\`\`\`

## 🚀 快速开始

### 开发模式

\`\`\`bash
pnpm dev          # 开发模式（支持热重载）
\`\`\`

1. 确认终端里 Host 已启动（一般为 \`http://127.0.0.1:${DEFAULT_CREATE_BOT_HTTP_PORT}\`）。
2. 打开 **[Remote Console](https://console.zhin.dev)**，API Base 填 \`http://127.0.0.1:${DEFAULT_CREATE_BOT_HTTP_PORT}\`，Token 填 \`.env\` 的 \`HTTP_TOKEN\`。
3. 进入 **Sandbox / 沙盒** 页并连接，发送 \`hello\`；收到回复即首跑成功。
4. 若连接失败，先运行 \`npx zhin doctor\` 查看修复建议。

### Remote Console（同上）

- UI: \`https://console.zhin.dev\`
- API Base: \`http://127.0.0.1:${DEFAULT_CREATE_BOT_HTTP_PORT}\`（与 Host 启动日志一致）
- Token: \`.env\` 中的 \`HTTP_TOKEN\`，在 Console 登录页填写

默认配置已经允许官方 Remote Console Origin。如需本地开发控制台，在 \`${configFilename}\` 的 \`http.corsOrigins\` 中追加本地 Origin。

### 启用 AI（可选）

首跑默认是 IM-only，不依赖 Ollama 或任何云模型。跑通 Sandbox 后再启用 AI：

\`\`\`bash
npx zhin setup --ai
pnpm install
pnpm dev
\`\`\`

本地模型用户请先启动 Ollama 并 pull 对应模型；云模型用户按向导把 API Key 写入 \`.env\`。

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

在 \`${configFilename}\` 中启用插件：

\`\`\`${configLanguage}
plugins:
  - "@zhin.js/adapter-sandbox"
  - "@zhin.js/host-router"
  - "@zhin.js/host-api"
  - example  # 你的插件名称
\`\`\`

## 🤖 AI Agent

如果初始化时启用了 AI，配置会写入 \`${configFilename}\`，API Key 会写入 \`.env\`。脚手架已预装 \`@modelcontextprotocol/sdk\`，可直接使用 MCP 扩展。

常用可选能力（详见 [Agent 概念入门](https://zhin.js.org/advanced/agent-concepts) 与 [MCP 集成](https://zhin.js.org/advanced/mcp)）：

- \`ai.agent.phaseTrace: true\`：输出 Agent 阶段日志，便于排障。
- \`ai.agent.toolSearch: true\`：启用 deferred + Worker 工具编排（Stable 默认关闭）。
- \`ai.memoryMcp: true\`：启用本地知识图谱 memory MCP。
- \`ai.mcpServers\`：接入外部 MCP Server。

## 📥 统一收件箱

默认 SQLite 项目会启用 \`inbox.enabled\`，消息、请求和通知会写入内置数据库，便于 Console 和后续排障查看。

## ✅ 验证项目

\`\`\`bash
pnpm build        # 构建插件和客户端页面
pnpm dev          # 开发模式运行
\`\`\`

## 📚 文档

- [官方文档](https://zhin.js.org)
- [GitHub](https://github.com/zhinjs/zhin)

## 许可证

MIT License
`);
}

async function createAppModule(projectPath: string, projectName: string, options: InitOptions): Promise<void> {
  const configFilename = getConfigFilename(options.config);
  const configLanguage = options.config === 'json' ? 'json' : options.config === 'toml' ? 'toml' : 'yaml';

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
await fs.writeFile(path.join(projectPath, '.env.example'),
`# HTTP 服务配置（复制为 .env 后填写真实 Token）
HTTP_TOKEN=change-me
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
        "@zhin.js/host-api",
        "@zhin.js/contract",
        "@zhin.js/client",
        "@zhin.js/host-router"
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
  
  // Satori 卡片（文件顶 @jsxImportSource，与 IM 的 zhin.js JSX 分离）
  await fs.writeFile(path.join(projectPath, 'src', 'plugins', 'status-card.tsx'),
`/** @jsxImportSource @zhin.js/satori */
import {
  Card,
  CardHeader,
  Row,
  StatChip,
  wrapCardHtml,
  DEFAULT_CARD_THEME,
} from '@zhin.js/satori';

export interface StatusCardLine {
  label: string;
  value: string;
}

export function buildStatusCard(title: string, lines: StatusCardLine[]): string {
  const body = (
    <Card>
      <CardHeader title={title} meta="Zhin.js 示例卡片" />
      <Row gap={10}>
        {lines.map((line) => (
          <StatChip
            key={line.label}
            label={line.label}
            value={line.value}
            accent={DEFAULT_CARD_THEME.accentMem}
          />
        ))}
      </Row>
    </Card>
  );
  return wrapCardHtml(body, DEFAULT_CARD_THEME.canvas);
}
`);

  // src/plugins/example.ts（参考 test-bot 的风格）
  await fs.writeFile(path.join(projectPath, 'src', 'plugins', 'example.ts'),
`import { usePlugin, MessageCommand, Time, segment, type MessageElement } from 'zhin.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildStatusCard } from './status-card.js';

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
      return [
        '你好！欢迎使用 Zhin.js！',
        '试试 card 查看 JSX 状态卡片。',
        '启用 AI：npx zhin setup --ai，然后在 Sandbox 发 ai: 你好',
      ].join('\\n');
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

// 状态卡片（@zhin.js/satori JSX → segment.html；安装 html-renderer 可自动转图）
addCommand(
  new MessageCommand('card')
    .desc('示例状态卡片', '使用 @zhin.js/satori JSX 生成 HTML 卡片')
    .usage('card')
    .action(() => {
      const mem = process.memoryUsage();
      const html = buildStatusCard('运行状态', [
        { label: 'RSS', value: \`\${Math.round(mem.rss / 1024 / 1024)}MB\` },
        { label: '堆', value: \`\${Math.round(mem.heapUsed / 1024 / 1024)}MB\` },
        { label: '运行', value: Time.formatTime(process.uptime() * 1000) },
      ]);
      return segment.html({ html, width: 540 });
    })
);

addCommand(
  new MessageCommand("send").action(
    (_, result) => result.remaining as MessageElement[]
  )
);
// 注册客户端页面（PageManager.addEntry；需启用 @zhin.js/host-api）
useContext('web', (pageManager) => {
  if (!pageManager || typeof pageManager.addEntry !== 'function') return;
  pageManager.addEntry({
    id: 'example',
    development: path.resolve(process.cwd(), 'client/index.tsx'),
    production: path.resolve(process.cwd(), 'dist/index.js'),
    meta: { name: 'Example' },
  });
});
`);
  
  // client/index.tsx（参考 test-bot 的简洁风格）
  await fs.writeFile(path.join(projectPath, 'client', 'index.tsx'),
`import type { PluginRegisterHostApi } from '@zhin.js/contract';

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
              <li>• 修改配置: <code className="bg-gray-100 px-2 py-1 rounded">${configFilename}</code></li>
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

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: '/console/home',
    name: '首页',
    element: api.React.createElement(HomePage),
  });
}
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
      "declarationMap": true,
      "sourceMap": true,
      "skipLibCheck": true,
      "noEmit": false
    },
    "include": [
      "./**/*"
    ]
  }, { spaces: 2 });

  // 生活助手模板额外文件
  if (options.template === 'life-assistant') {
    // knowledge 目录
    await fs.ensureDir(path.join(projectPath, 'knowledge'));
    await fs.writeFile(path.join(projectPath, 'knowledge', 'faq.md'),
`# 常见问题

## 如何添加新知识？

在 \`knowledge/\` 目录下创建 \`.md\` 文件即可。下次查询时自动发现。

## 如何更换 AI 模型？

修改 \`zhin.config.yml\` 中 \`ai.agents.zhin.model\` 字段。
`);

    // 三层记忆目录骨架
    await fs.ensureDir(path.join(projectPath, 'data', 'memory', 'global'));
    await fs.ensureDir(path.join(projectPath, 'data', 'memory', 'platforms'));
    await fs.ensureDir(path.join(projectPath, 'data', 'memory', 'sessions'));

    // 覆盖 SOUL.md 为生活助手人设
    await fs.writeFile(path.join(projectPath, 'SOUL.md'),
`# 你是谁

你是一个生活助手。你善于聊天、记住用户喜好、查询知识库、设置提醒。

## 性格

- 友好、耐心、有条理
- 回答简洁，不啰嗦
- 遇到不确定的事情会诚实说"我不确定"

## 能力

1. **日常聊天** — 回答问题、闲聊、推荐
2. **知识检索** — 使用 \`knowledge_search\` 查询本地知识库
3. **记忆** — 记住用户告诉你的偏好和事实
4. **时间感知** — 使用 \`get_current_time\` 了解当前时间

## 限制

- 你不是代码助手，不写代码
- 你不执行危险的 bash 命令
`);

    // 生活助手插件
    await fs.writeFile(path.join(projectPath, 'src', 'plugins', 'assistant.ts'),
`import { usePlugin, MessageCommand, Cron } from 'zhin.js';

const { addCommand, addCron, addTool, onMounted, logger } = usePlugin();

addCommand(
  new MessageCommand('remind <text:text>')
    .desc('设置提醒')
    .action((_, result) => \`✅ 已记录提醒：\${result.params.text}\`),
);

addTool({
  name: 'get_current_time',
  description: '获取当前日期和时间',
  parameters: { type: 'object', properties: {} },
  execute: async () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
});

addCron(new Cron('0 8 * * *', async () => { logger.info('早安提醒'); }));
addCron(new Cron('0 22 * * *', async () => { logger.info('晚安提醒'); }));

onMounted(() => { logger.info('生活助手插件已启动'); });
`);
  }

  // 创建配置文件
  await createConfigFile(projectPath, options.config!, options);
}
