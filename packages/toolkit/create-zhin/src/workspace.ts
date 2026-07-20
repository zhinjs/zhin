import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DATABASE_PACKAGES,
  ZHIN_STACK_VERSIONS,
  collectAdapterPluginManifest,
  generateAdapterEnvVars,
  generateAIEnvVars,
  getAdapterDependencies,
  getAIDependencies,
  getCreateBotBaseDependencies,
  CREATE_BOT_NPMRC,
  getCreateBotPnpmConfig,
  type AdapterSetupResult,
  type InitOptions,
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

/** 未显式配置适配器时默认挂载 Sandbox（对齐 examples/test-bot 的 sandbox 实例） */
function resolveAdapterResult(options: InitOptions): AdapterSetupResult {
  if (options.adapters) return options.adapters;
  return {
    packages: ['@zhin.js/adapter-sandbox'],
    plugins: ['@zhin.js/adapter-sandbox'],
    instances: [{
      package: '@zhin.js/adapter-sandbox',
      instanceKey: 'sandbox',
      config: { endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' }] },
    }],
    envVars: {},
  };
}

export async function createWorkspace(projectPath: string, projectName: string, options: InitOptions): Promise<void> {
  const configFilename = getConfigFilename(options.config);
  const adapters = resolveAdapterResult(options);
  const aiEnabled = options.ai?.enabled === true;

  await fs.ensureDir(projectPath);

  await fs.writeFile(path.join(projectPath, '.npmrc'), CREATE_BOT_NPMRC);

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
    databaseDeps['@zhin.js/database'] = 'latest';
  }

  // 根据适配器选择添加依赖
  const adapterDeps: Record<string, string> = { ...getAdapterDependencies(adapters) };
  if (!adapterDeps['@zhin.js/adapter-sandbox']) {
    adapterDeps['@zhin.js/adapter-sandbox'] = 'latest';
  }

  // AI 依赖（agent 栈 + 所选 @ai-sdk/*）；tools/ 约定需要 @zhin.js/tool
  const aiDeps: Record<string, string> = { ...getAIDependencies(options.ai) };
  if (aiEnabled) {
    aiDeps['@zhin.js/tool'] = ZHIN_STACK_VERSIONS['@zhin.js/tool'];
  }

  // package.json：zhin 清单是 Plugin Runtime 拓扑 SSOT（features + plugins）
  await fs.writeJson(path.join(projectPath, 'package.json'), {
    name: projectName,
    private: true,
    version: '0.1.0',
    type: 'module',
    description: `${projectName} - Zhin.js Bot`,
    scripts: {
      dev: 'zhin runtime start',
      start: 'zhin runtime start --mode production --no-watch',
      build: 'tsc --noEmit',
      'pm2:start': 'pm2 start ecosystem.config.cjs',
      'pm2:stop': 'pm2 stop ecosystem.config.cjs',
      'pm2:restart': 'pm2 restart ecosystem.config.cjs',
      'pm2:delete': 'pm2 delete ecosystem.config.cjs',
      'pm2:logs': 'pm2 logs',
      'pm2:monit': 'pm2 monit'
    },
    dependencies: {
      ...getCreateBotBaseDependencies(),
      ...adapterDeps,
      ...databaseDeps,
      ...aiDeps
    },
    devDependencies: {
      '@zhin.js/cli': ZHIN_STACK_VERSIONS['@zhin.js/cli'],
      '@types/node': '^25.0.0',
      'typescript': '^6.0.0',
      'pm2': '^6.0.0'
    },
    pnpm: getCreateBotPnpmConfig(aiEnabled),
    engines: {
      node: '>=22.6.0'
    },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      engine: '^1.0.0',
      runtime: 'trusted',
      features: [
        { package: '@zhin.js/adapter', api: '^1.0.0' },
        { package: '@zhin.js/command', api: '^1.0.0' },
        { package: '@zhin.js/component', api: '^1.0.0' },
        ...(aiEnabled ? [{ package: '@zhin.js/tool', api: '^1.0.0' }] : []),
      ],
      plugins: collectAdapterPluginManifest(adapters),
    }
  }, { spaces: 2 });

  // Plugin Runtime 项目骨架（对齐 examples/minimal-bot）
  await createRuntimeProjectFiles(projectPath, projectName, options);

  // AI 引导文件（人格 / 工具约定 / 记忆），仅启用 AI 时生成
  if (aiEnabled) {
    await fs.writeFile(path.join(projectPath, 'SOUL.md'), SOUL_MD_TEMPLATE);
    await fs.writeFile(path.join(projectPath, 'TOOLS.md'), TOOLS_MD_TEMPLATE);
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), AGENTS_MD_TEMPLATE);
    await fs.writeFile(path.join(projectPath, 'assistant.profile.yml.example'), ASSISTANT_PROFILE_YML_EXAMPLE);
  }

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

  // 创建 systemd service 配置（Linux）：当前目录用 npx 启动，不写死 nvm/node 路径
  await fs.writeFile(path.join(projectPath, `${projectName}.service`),
`[Unit]
Description=${projectName} - Zhin.js Endpoint
After=network.target

[Service]
Type=simple
User=%i
WorkingDirectory=${path.resolve(projectPath)}
ExecStart=/usr/bin/env npx zhin runtime start --mode production --no-watch
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
        <string>runtime</string>
        <string>start</string>
        <string>--mode</string>
        <string>production</string>
        <string>--no-watch</string>
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
$NpxArgs = "runtime start --mode production --no-watch"

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
nssm install $ServiceName npx zhin $NpxArgs

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
      <Arguments>zhin runtime start --mode production --no-watch</Arguments>
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
      args: 'runtime start --mode production --no-watch',
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
*.log
logs/
.env
.env.*
!.env.development
!.env.production
!.env.example
.DS_Store
data/
.pm2/
`);

  // 创建 README.md
  await fs.writeFile(path.join(projectPath, 'README.md'),
`# ${projectName}

使用 Zhin.js Plugin Runtime 创建的机器人项目（约定式插件：\`plugin.ts\` + \`commands/\` + \`components/\`）。

## 📁 项目结构

\`\`\`
${projectName}/
├── plugin.ts              # definePlugin()，根插件入口
├── schema.json            # 根插件配置契约（JSON Schema）
├── ${configFilename}     # 顶层 http/database/ai + plugins.<instanceKey> 配置
├── commands/
│   ├── hello.ts           # /hello 命令（defineCommand）
│   └── card.ts            # /card -> component("status-card")
├── components/
│   └── status-card.ts     # defineComponent()，Satori 卡片
├── package.json           # zhin 清单（protocol 1 / features / plugins）
├── tsconfig.json
└── pnpm-workspace.yaml
\`\`\`

\`package.json#zhin\` 是拓扑 SSOT：\`features\` 挂载的 Feature provider 会发现对应约定目录，
\`zhin.plugins\` 清单声明挂载的子插件（适配器）实例，实例配置写在 \`${configFilename}\` 的 \`plugins.<instanceKey>\`。

## 🚀 快速开始

### 开发模式

\`\`\`bash
pnpm dev          # zhin runtime start（监听文件变更，热重载）
\`\`\`

1. 确认终端里 Runtime 已启动（HTTP Host 一般为 \`http://127.0.0.1:8068\`）。
2. 打开 **[Remote Console](https://console.zhin.dev)**，API Base 填 \`http://127.0.0.1:8068\`，Token 填 \`.env\` 的 \`HTTP_TOKEN\`。
3. 进入 **Sandbox / 沙盒** 页并连接，发送 \`/hello\`；收到回复即首跑成功。
4. 若连接失败，先运行 \`npx zhin doctor\` 查看修复建议。

### 生产模式

\`\`\`bash
pnpm start        # zhin runtime start --mode production --no-watch（前台）
pnpm pm2:start    # 或使用 PM2 守护
\`\`\`

也可以使用随项目生成的 systemd / launchd / NSSM 服务配置（命令均为 \`zhin runtime start --mode production --no-watch\`）。

### 启用 AI（可选）

首跑默认是 IM-only，不依赖 Ollama 或任何云模型。跑通 Sandbox 后再启用 AI：

\`\`\`bash
npx zhin setup --ai
pnpm install
pnpm dev
\`\`\`

本地模型用户请先启动 Ollama 并 pull 对应模型；云模型用户按向导把 API Key 写入 \`.env\`。

## 🔌 插件开发

### 新增命令

在 \`commands/\` 下创建 \`.ts\` 文件（默认导出 \`defineCommand\`）：

\`\`\`typescript
import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: '打招呼',
  execute: () => '你好！',
});
\`\`\`

### 接入更多平台

\`\`\`bash
npx zhin setup --adapters   # 选择平台并写入 plugins.<instanceKey> 配置与 zhin.plugins 清单
\`\`\`

## 🤖 AI Agent

如果初始化时启用了 AI，配置会写入 \`${configFilename}\` 的 \`ai:\` 段，API Key 会写入 \`.env\`。
启用后 \`tools/\` 约定目录下的 \`defineAgentTool\` 工具会被 Agent 自动发现。

## ✅ 验证项目

\`\`\`bash
pnpm build        # tsc --noEmit 类型检查
pnpm dev -- --once  # 启动一个 generation 自检后退出
\`\`\`

## 📚 文档

- [官方文档](https://zhin.js.org)
- [GitHub](https://github.com/zhinjs/zhin)

## 许可证

MIT License
`);
}

async function createRuntimeProjectFiles(projectPath: string, projectName: string, options: InitOptions): Promise<void> {
  const aiEnabled = options.ai?.enabled === true;

  await fs.ensureDir(path.join(projectPath, 'commands'));
  await fs.ensureDir(path.join(projectPath, 'components'));
  await fs.ensureDir(path.join(projectPath, 'data'));

  // 创建 .env 文件（使用简单的变量名）
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

  // tsconfig.json（独立项目，对齐 examples/minimal-bot 的编译选项）
  await fs.writeJson(path.join(projectPath, 'tsconfig.json'), {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "noEmit": true,
      "types": ["node"]
    },
    "include": [
      "plugin.ts",
      "commands/**/*.ts",
      "components/**/*.ts",
      "tools/**/*.ts"
    ],
    "exclude": [
      "node_modules"
    ]
  }, { spaces: 2 });

  // plugin.ts（根插件入口）
  await fs.writeFile(path.join(projectPath, 'plugin.ts'),
`import { definePlugin } from '@zhin.js/plugin-runtime';

export default definePlugin({
  name: '${projectName}',
  metadata: {
    displayName: '${projectName}',
  },
});
`);

  // schema.json（根插件配置契约，暂无可配置项）
  await fs.writeJson(path.join(projectPath, 'schema.json'), {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }, { spaces: 2 });

  // commands/hello.ts
  await fs.writeFile(path.join(projectPath, 'commands', 'hello.ts'),
`import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: '打招呼',
  execute: () => [
    '你好！欢迎使用 Zhin.js！',
    '试试 /card 查看状态卡片。',
    '启用 AI：npx zhin setup --ai，然后在 Sandbox 发 ai: 你好',
  ].join('\\n'),
});
`);

  // commands/card.ts（组件渲染示例，对齐 examples/minimal-bot）
  await fs.writeFile(path.join(projectPath, 'commands', 'card.ts'),
`import { defineCommand } from '@zhin.js/command';
import { component } from '@zhin.js/core/runtime';

export default defineCommand({
  description: '渲染 Satori 状态卡片',
  execute: () => {
    const memory = process.memoryUsage();
    return component('status-card', {
      title: '${projectName}',
      lines: [
        { label: 'RSS', value: \`\${Math.round(memory.rss / 1024 / 1024)}MB\` },
        { label: 'Heap', value: \`\${Math.round(memory.heapUsed / 1024 / 1024)}MB\` },
      ],
    });
  },
});
`);

  // components/status-card.ts
  await fs.writeFile(path.join(projectPath, 'components', 'status-card.ts'),
`import { defineComponent } from '@zhin.js/component';
import { raw } from '@zhin.js/core/runtime';
import {
  Card,
  CardHeader,
  Row,
  StatChip,
  h,
  wrapCardHtml,
  DEFAULT_CARD_THEME,
} from '@zhin.js/satori';

interface StatusCardProps {
  readonly title: string;
  readonly lines: readonly {
    readonly label: string;
    readonly value: string;
  }[];
}

export default defineComponent<StatusCardProps>({
  render({ title, lines }) {
    const body = h(Card, {
      children: [
        h(CardHeader, { title, meta: '${projectName}' }),
        h(Row, {
          gap: 10,
          children: lines.map((line) => h(StatChip, {
            label: line.label,
            value: line.value,
            accent: DEFAULT_CARD_THEME.accentMem,
          })),
        }),
      ],
    });
    return raw({
      type: 'html',
      data: {
        html: wrapCardHtml(body, DEFAULT_CARD_THEME.canvas),
        width: 540,
      },
    });
  },
});
`);

  // tools/echo.ts（AI 启用时生成，defineAgentTool 约定目录）
  if (aiEnabled) {
    await fs.ensureDir(path.join(projectPath, 'tools'));
    await fs.writeFile(path.join(projectPath, 'tools', 'echo.ts'),
`import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ message: string }>({
  description: '回显一条消息（defineAgentTool 示例）',
  inputSchema: z.object({ message: z.string().min(1) }),
  async execute({ message }) {
    return \`echo: \${message}\`;
  },
});
`);
  }

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

    // 生活助手命令与工具（工具需 AI 启用才挂载 @zhin.js/tool feature）
    await fs.writeFile(path.join(projectPath, 'commands', 'remind.ts'),
`import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: '设置提醒',
  execute: ({ args }) => \`✅ 已记录提醒：\${args.join(' ')}\`,
});
`);

    if (aiEnabled) {
      await fs.ensureDir(path.join(projectPath, 'tools'));
      await fs.writeFile(path.join(projectPath, 'tools', 'get_current_time.ts'),
`import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool({
  description: '获取当前日期和时间',
  inputSchema: z.object({}),
  async execute() {
    return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  },
});
`);
    }
  }

  // 创建配置文件（新 Plugin Runtime 格式）
  await createConfigFile(projectPath, options.config!, options);
}
