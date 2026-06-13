# 配置文件

Zhin.js 在项目根目录自动发现主配置文件，支持 **YAML**（`zhin.config.yml` / `.yaml`）、**JSON**（`zhin.config.json`）和 **TOML**（`zhin.config.toml`）。发现优先级：`.yml` → `.yaml` → `.json` → `.toml`。

配置遵循“约定大于配置”：运行时会把默认约定作为 base，再把用户配置 deep merge 进去。普通对象按字段合并；`plugins`、`plugin_dirs`、`services` 等数组字段如果显式写出，就表示完整覆盖默认数组，省略则使用默认约定。

## 配置文件位置

配置文件位于项目根目录：

```
my-bot/
├── zhin.config.yml  ← 主配置文件（也可使用 .yaml / .json / .toml）
├── .env             ← 环境变量（令牌、密码等敏感信息）
├── src/
└── package.json
```

## 基础配置

### 日志级别

控制输出的日志详细程度：

```yaml
# 日志级别 (0=debug, 1=info, 2=warn, 3=error)
log_level: 1
```

**级别说明**：
- `0` (debug) - 输出所有日志，包括调试信息（开发时使用）
- `1` (info) - 输出普通信息和以上（**推荐**）
- `2` (warn) - 只输出警告和错误
- `3` (error) - 只输出错误信息

### 调试模式

```yaml
debug: true  # 启用调试模式，会输出更多内部信息
```

### 插件目录

指定插件的搜索路径：

```yaml
plugin_dirs:
  - node_modules      # npm 安装的插件
  - ./src/plugins     # 你的本地插件
```

**说明**：
- 默认值为 `node_modules` 和 `./src/plugins`，通常可以省略。
- `node_modules` - 通过 npm/pnpm 安装的插件包
- `./src/plugins` - 你自己编写的插件文件
- 框架按列表顺序搜索，先找到即加载

### 核心服务

启用框架的核心服务：

```yaml
services:
  - process      # 进程管理（终端适配器）
  - config       # 配置管理
  - command      # 命令系统
  - component    # 组件系统
  - permission   # 权限管理
  - cron         # 定时任务
```

**说明**：这些是框架的核心功能，通常不需要修改。框架还会自动注册 `dispatcher`（消息调度）和 `skill`（AI 技能）服务。

### 插件列表

启用要使用的插件：

```yaml
plugins:
  - "@zhin.js/host-router"            # HTTP 服务
  - "@zhin.js/host-api"        # Host 管理面 API（REST + Console 协议）
  - "@zhin.js/adapter-sandbox" # 终端适配器
  - "@zhin.js/adapter-icqq"   # ICQQ 适配器
  - my-plugin                  # 你的本地插件
```

**注意**：
- npm 插件使用完整包名（如 `@zhin.js/host-router`）
- 本地插件使用文件名（如 `my-plugin` 对应 `src/plugins/my-plugin.ts`）
- 一旦写出 `plugins` 数组，就表示完整插件列表；如果要保留默认 HTTP、Console、Sandbox 插件，需要一并写出。

## 机器人配置（bots）

`endpoints` 数组定义了每个平台的机器人实例。每个 bot 通过 `context` 字段关联到对应的适配器：

```yaml
endpoints:
  # ICQQ (QQ)：须先 `icqq login`，再配置同名 QQ 号
  - context: icqq
    name: "${ICQQ_ACCOUNT}"

  # QQ 官方机器人
  - context: qq
    name: qq-bot
    appid: "${QQ_APPID}"
    secret: "${QQ_SECRET}"

  # KOOK 机器人
  - context: kook
    name: kook-bot
    token: "${KOOK_TOKEN}"

  # Discord 机器人
  - context: discord
    name: discord-bot
    token: "${DISCORD_TOKEN}"
```

**说明**：
- `context` 必须与适配器名称匹配（如 `icqq`、`qq`、`kook`、`discord`）
- 使用 `${VAR}` 引用 `.env` 文件中的环境变量
- 一个适配器可以配置多个 endpoint（不同账号）
- **ICQQ 文生图出站**：Zhin 与 icqq 守护进程异机/异进程时，在 icqq bot 下设置 `outboundMedia: base64`（配置 `rpc` 时默认 `base64`）；同机可省略。见 `plugins/adapters/icqq/README.md` 与 [文生图](/advanced/ai#文生图-generate_image)

## 数据库配置

配置数据存储：

```yaml
database:
  dialect: sqlite              # 数据库类型
  filename: ./data/database.db # 数据库文件路径
```

**支持的数据库类型**：
- `sqlite` - SQLite（推荐，无需额外配置）
- `mysql` - MySQL（需要额外安装驱动）
- `postgres` - PostgreSQL（需要额外安装驱动）

**SQLite 配置**：
```yaml
database:
  dialect: sqlite
  filename: ./data/database.db  # 相对于项目根目录
```

**MySQL 配置**：
```yaml
database:
  dialect: mysql
  host: localhost
  port: 3306
  username: root
  password: ${DB_PASSWORD}  # 从环境变量读取
  database: zhin
```

## AI 配置

配置 AI 大模型集成：

```yaml
ai:
  enabled: true

  # 命名 provider 实例（api + 连接参数；`driver` 为遗留别名，会归一化为 api）
  providers:
    ds-main:
      api: openai-completions
      apiKey: "${DEEP_SEEK_API_KEY}"
      baseUrl: "https://api.deepseek.com"
    zhipu-vl:
      api: openai-completions
      apiKey: "${BIG_MODEL_API_KEY}"
      baseUrl: "https://open.bigmodel.cn/api/paas/v4"
      imageGeneration:
        defaultModel: cogview-3-flash
        watermarkEnabled: false

  # 入站/子 agent 绑定：模型 + MCP 子集（persona 在 agents/*.agent.md；工具由编排 + TF-IDF 选用）
  agents:
    zhin:
      provider: ds-main
      model: deepseek-chat
      mcpServers: [icqq]
    vision:
      provider: zhipu-vl
      model: glm-4.6v
      priority: 100
      match:
        hasMedia: [image]
    draw:
      provider: zhipu-vl
      model: glm-4.7-flash

  # 入站识图：agents.vision + agents/vision.agent.md
  # 文生图：run_deferred_task 或 spawn_task(agent: draw) + generate_image（provider_alias 如 zhipu-vl）
  imageGeneration:
    watermarkEnabled: false

  # 可选文生图 provider 见 docs/advanced/ai.md#文生图-generate_image

  # 全局 MCP 注册表（懒连接；谁用哪些由 agents.<name>.mcpServers 决定）
  mcpServers:
    - name: icqq
      transport: streamable-http
      url: "${ICQQ_MCP_URL}"

  # 会话配置（省略时使用框架默认：DB 模式 maxHistory 200 / expireMs 7 天；内存模式 100 / 24 小时）
  sessions:
    useDatabase: true
    maxHistory: 50
    expireMs: 3600000

  # 场景摘要（辅助；LLM 主历史见 ContextRepository / agent_messages）
  context:
    enabled: true
    maxRecentMessages: 100
    summaryThreshold: 50
    keepAfterSummary: 10
    maxContextTokens: 4000

  # 触发配置（默认前缀：#、AI:、ai:）
  trigger:
    respondToAt: true
    respondToPrivate: true
    prefixes: ["#", "AI:", "ai:"]
    ignorePrefixes: ["/", "!", "！"]
    timeout: 60000
```

### Agent 配置

AI Agent 的行为控制在 `ai.agent` 下配置：

```yaml
ai:
  agent:
    # 模型与工具白名单已迁至 ai.agents.<name>（zhin 为默认入站统筹）
    execSecurity: allowlist     # deny / allowlist / full（默认 deny，示例为 allowlist）
    execPreset: custom          # readonly / network / development / custom（默认 custom）
    execAllowlist: ["docker"]   # 与 preset 合并
    execApprovalMode: deny      # ask / allow / deny（默认 deny）；见 [advanced/ai.md](/advanced/ai#交互式审批-execapprovalmode-ask)
    maxIterations: 15           # 默认 15
    contextTokens: 128000
    maxHistoryShare: 0.5
    toneAwareness: true
    modelSizeHint: ""           # small / medium / large，留空按模型名推断
    skillInstructionMaxChars: 0 # 0 = 按 modelSizeHint 自动推断
    maxSubagentIterations: 25   # 默认 25
    phaseTrace: false           # 输出 Agent 回合 phase 日志（也可用 ZHIN_AGENT_PHASE_TRACE=1）
    compaction:               # ADR 0010 — L1 micro + L2 LLM；IM /compact 手动触发
      enabled: true
      auto: true
      keepRecentTokens: 20000
      minKeepCount: 2
    modelHarness:               # 按 provider 模式 / model id 覆盖 harness（与 TS 默认 deep merge）
      providerPatterns:
        "open*":
          maxIterations: 7
      models:
        "openai:gpt-4o":
          maxIterations: 9
```

完整配置项说明详见 [AI 模块文档 — Agent 配置详解](/advanced/ai#agent-配置详解)。

### Advanced AI 开关

以下能力属于 **Advanced**，Stable 脚手架与 [minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 默认关闭。概念说明见 [Agent 概念入门](/advanced/agent-concepts)，MCP 实操见 [MCP 集成](/advanced/mcp)。

```yaml
ai:
  # 三层 Markdown 文件记忆（默认启用；见下方 memory 段）
  memory:
    enabled: true
    budgets:
      session: 8000
      platform: 4000
      global: 4000
      daily: 2000

  # @deprecated 请用 ai.memory 文件三层；仍为 true 时注册 MCP 图谱并打警告
  memoryMcp: false

  # 外部 MCP Server 列表（默认 []）
  mcpServers:
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/zhin-mcp-test"]

  # GitHub MCP（可选；配合 @zhin.js/adapter-github，见 /adapters/github）
  githubMcp:
    token: "${GITHUB_PERSONAL_ACCESS_TOKEN}"

  agent:
    # deferred Worker 工具编排（Stable 默认 false）
    toolSearch: false
    phaseTrace: false   # Agent 阶段日志，排障时可开 true

  # 多模态入站/出站（base64 契约；平台 Adapter 负责编解码发送）
  multimodal:
    enabled: true
    maxFileBytes: 26214400
    inboundDir: data/media/inbound
    outboundDir: data/media/outbound
    image:
      maxDimension: 2048
      preferNativeVision: true
    audio:
      strategy: mcp          # mcp | plugin-voice | text-only
      mcpServer: whisper     # 可选，STT MCP 名称
    video:
      strategy: mcp          # mcp | text-only
      mcpServer: ffmpeg
      maxFrames: 8
    outbound:
      splitMessages: auto    # auto | single | always_split
```

### 三层文件记忆（Stable 默认启用）

目录在运行目录下的 `data/memory/`：

| 层级 | 路径 | 内容 | 写入 |
|------|------|------|------|
| 全局 | `global/MEMORY.md`、`global/YYYY-MM-DD.md` | 部署级长期事实与每日笔记 | 仅 master |
| 平台 | `platforms/{platform}/RULES.md`、`ADAPTER.md` | 平台规则与适配器手册 | 仅 master |
| 会话 | `sessions/{safeSessionKey}/MEMORY.md` | 绑定 `session_key` 的笔记 | 有 `write_file` 权限的用户 |

旧版 `data/memory/MEMORY.md` 会在首次加载时自动复制到 `global/MEMORY.md`。注入 system prompt 时优先级：会话 → 平台 → 全局 → 每日笔记（窗口紧时先裁每日）。

::: tip SDK 依赖
使用 `mcpServers` 或已弃用的 `memoryMcp: true` 前请安装：`pnpm add @modelcontextprotocol/sdk`
:::

### 本地知识库（knowledge_search 工具）

在项目根目录创建 `knowledge/` 目录，放入 `.md` / `.txt` 文件，Agent 即可通过 `knowledge_search` 工具检索本地文档（说明书、规章、菜谱、FAQ 等）。

```yaml
ai:
  knowledge:
    baseDir: knowledge    # 相对于项目根目录，默认 "knowledge"
```

框架启动时自动分块索引（段落级），支持关键词匹配搜索。索引带 60 秒缓存，新增文件下次查询时自动发现。

**说明**：
- AI 模块需要 `ai.providers` 至少一个实例，且 **`ai.agents.zhin`** 为必填绑定
- 旧版 `defaultProvider`、`ai.agent.chatModel` / `visionModel`、`allowedTools` / `disabledTools` 已移除，请迁移到 `ai.agents.<name>`
- 入站路由写在 `agents.<name>.priority` + `agents.<name>.match`（无 `route` 嵌套层）；`zhin` 不可写这两项
- 非 `zhin` 且带 `match` 的 agent 须存在 `agents/<name>.agent.md`；`zhin` 永不读 `zhin.agent.md`
- 旧版顶层 `ai.routes` 启动时自动合并进同名 `agents.*`（已废弃，请迁走）
- `tools[]` 为唯一工具白名单（内置、插件、`mcp_{server}_{tool}` 均须按名写出）
- `providers.*.models` 可省略 — `ModelRegistry` + `GET /v1/models`（或 Ollama `/api/tags`）发现；`getModel()` 用发现结果校验；`agents.<name>.model` 为首选绑定
- 当首选模型不可用时，系统自动降级到次优模型
- `modelHarness` 会在 TypeScript 默认 harness 之上做 deep merge：对象按字段合并，数组（如后续扩展字段）显式写出时完整覆盖默认数组
- `phaseTrace`（或环境变量 `ZHIN_AGENT_PHASE_TRACE=1`）可输出稳定的 `[AGENT_PHASE]` 阶段日志，便于排障与回归对照
- 支持 Ollama（本地模型）、OpenAI、以及其他兼容 OpenAI API 的服务（含中转/聚合服务）
- 详见 [AI 模块文档](/advanced/ai)

## HTTP 服务配置

配置 Web 服务器和 API：

```yaml
http:
  port: 8086                # 端口号
  host: "127.0.0.1"         # 监听地址，默认仅本机；部署/代理场景改为 "0.0.0.0"
  token: ${HTTP_TOKEN}      # API 访问令牌（从环境变量读取，不填自动生成）
  base: /api                # API 基础路径
  trustProxy: false         # 通过 Cloudflare/Nginx 等反向代理访问时设为 true
```

**认证方式**：Token 认证，仅保护 API 路径（`/api/*`）。在 **[Remote Console](https://console.zhin.dev)** 登录时填写 API Base（与 Host 监听地址一致，如 `http://127.0.0.1:8086`）和 Token；`:8086` 仅提供 API，不提供内置网页 UI。

Token 传递方式：
- **Header**: `Authorization: Bearer <token>`

以 `/pub` 为前缀的路径为公开入口，无需认证（如 `/pub/health`、`/pub/github/webhook` 等）。

**通过 Cloudflare 等反向代理公网访问时**，建议：

```yaml
http:
  port: 8086
  host: "0.0.0.0"           # 监听所有网卡，便于隧道或端口转发
  token: ${HTTP_TOKEN}
  base: /api
  trustProxy: true          # 信任 X-Forwarded-Host / X-Forwarded-Proto
```

- 使用 **Cloudflare Tunnel** 时，在 `cloudflared` 配置中将 `url` 指向 `http://localhost:8086`（或本机 `http://127.0.0.1:8086`）即可。
- Cloudflare 控制台 SSL/TLS 建议使用「完全」或「完全(严格)」，由 Cloudflare 提供 HTTPS。

## 进程保活与开机自启

Zhin.js 提供三种进程保活方案：

### 方案一：系统服务（推荐生产环境）

通过 **systemd**（Linux）或 **launchd**（macOS）实现系统级进程监督，确保守护进程本身也被监督。

**优点**：
- ✅ 系统级监督，守护进程崩溃也能自动重启
- ✅ 开机自启动
- ✅ 无需额外依赖
- ✅ 与系统日志集成

**安装步骤**：

```bash
# 1. 构建项目
pnpm build

# 2. 安装系统服务
zhin install-service

# 3. Linux (systemd)
sudo systemctl daemon-reload
sudo systemctl enable your-bot.service
sudo systemctl start your-bot.service

# 查看状态和日志
sudo systemctl status your-bot.service
sudo journalctl -u your-bot.service -f

# 4. macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.zhinjs.your-bot.plist
launchctl start com.zhinjs.your-bot

# 查看状态
launchctl list | grep your-bot
tail -f logs/launchd-stdout.log

# 5. Windows (NSSM)
# 先安装 NSSM: choco install nssm 或 scoop install nssm
zhin install-service
.\install-service.ps1    # 以管理员身份运行
nssm start your-bot

# 查看状态
nssm status your-bot
type logs\nssm-stdout.log
```

**卸载服务**：

```bash
zhin uninstall-service
```

### 方案二：PM2

适合需要多进程管理、监控面板的场景。

```bash
pnpm build
pnpm pm2:start

# 开机自启
pm2 startup
pm2 save
```

### 方案三：内置守护模式

轻量简单，适合开发/测试环境。

```bash
pnpm build
pnpm daemon  # 或 zhin start --daemon
```

**注意**：内置守护模式的守护进程本身不受系统监督，如果守护进程崩溃则需要手动重启。

### 方案对比

| 方案 | 平台支持 | 优点 | 缺点 | 推荐场景 |
|------|----------|------|------|----------|
| **系统服务** | Linux, macOS, Windows | • 系统级监督<br>• 开机自启<br>• 无需额外依赖 | • 需要系统权限<br>• 配置稍复杂 | **生产环境首选** |
| **PM2** | 全平台 | • 功能丰富<br>• 监控面板<br>• 集群模式 | • 需要额外依赖<br>• 占用资源 | 多进程管理 |
| **内置守护** | 全平台 | • 轻量简单<br>• 无需依赖 | • 无系统级监督 | 开发/测试环境 |

### Windows 特别说明

**NSSM vs 任务计划程序**：

- **NSSM**（推荐）：
  - ✅ 真正的 Windows 服务
  - ✅ 自动重启、日志轮转
  - ✅ 服务管理界面（`services.msc`）
  - ❌ 需要额外安装（`choco install nssm` 或 `scoop install nssm`）

- **任务计划程序**：
  - ✅ Windows 内置，无需安装
  - ✅ 开机自启
  - ❌ 功能较弱，重启策略有限
  - ❌ 管理不如服务方便

**安装 NSSM**：
```powershell
# 方式一：Chocolatey
choco install nssm

# 方式二：Scoop
scoop install nssm

# 方式三：手动下载
# https://nssm.cc/download
```

## Web 控制台配置

`@zhin.js/host-api` 在 `@zhin.js/host-router` 的 Router 上注册 **管理面 API**（系统/插件/Bot REST、`PageManager`、`/api/console/*`、`/api/events` 等）。UI 在 **[Remote Console](https://console.zhin.dev)**（独立仓库 [zhin-console](https://github.com/zhinjs/zhin-console)）。详见 [console-remote.md](../console-remote.md)。

```yaml
hostApi:
  enabled: true      # 是否启用 Host API（非 Host 静态页）
  lazyLoad: false    # 是否延迟初始化 PageManager（与 Remote UI 无关）
```

## 环境变量

Zhin.js 支持在配置文件中通过 `${VAR}` 引用环境变量：

```yaml
# 基础用法
token: ${HTTP_TOKEN}

# 带默认值
port: ${PORT:-8086}         # 如果 PORT 未设置，使用 8086
```

在项目根目录的 `.env` 文件中设置：

```bash
HTTP_TOKEN=your_secure_token
ICQQ_ACCOUNT=123456789   # ICQQ：仅 QQ 号；登录在 icqq login / CLI 中完成，勿写入 zhin.config
```

**为什么使用环境变量？**
- 安全 - 令牌和密码不会提交到 Git
- 灵活 - 不同环境使用不同配置
- 标准 - 符合 12-Factor App 原则

## 插件配置

### 本地插件

本地插件是你自己编写的插件文件。

**目录结构**：
```
src/
└── plugins/
    ├── hello.ts      # 插件文件
    └── todo.ts       # 另一个插件
```

**配置**：
```yaml
plugin_dirs:
  - ./src/plugins     # 插件目录

plugins:
  - hello            # 加载 src/plugins/hello.ts
  - todo             # 加载 src/plugins/todo.ts
```

### npm 插件

npm 插件是通过包管理器安装的插件。

**安装插件**：
```bash
pnpm add @zhin.js/plugin-music
```

**配置**：
```yaml
plugins:
  - "@zhin.js/host-router"          # HTTP 服务
  - "@zhin.js/plugin-music"  # 音乐插件
```

### 插件级配置

部分插件支持在主配置文件中设置自己的配置，键名为插件名：

```yaml
# HTTP 插件配置
http:
  port: 8086

# Host API 插件配置
hostApi:
  enabled: true

# 自定义插件配置（通过 addConfig 注册）
my-plugin:
  apiKey: "${MY_API_KEY}"
  timeout: 5000
```

### 禁用插件

注释掉不需要的插件：

```yaml
plugins:
  - "@zhin.js/host-router"
  # - "@zhin.js/plugin-music"  # 已禁用
```

## Assistant Runtime（Advanced / opt-in）

个人助手主动能力：统一 JobStore、事件入口、通知路由。默认 **关闭**，Stable 路径（minimal-bot）不受影响。详见 [Assistant Runtime 路线图](/architecture/assistant-runtime)。

```yaml
assistant:
  enabled: true
  legacyDualWrite: false   # 默认；迁移期可 true 双写 cron-jobs.json
  queue:                   # TaskQueue 并发 / 重试（默认 enabled 随 assistant.enabled）
    enabled: true
    maxConcurrency: 3
    maxRetries: 2
  defaults:
    notify:               # 运行时未指定 notify 的 Job 默认 IM 投递目标
      channel: im
      platform: icqq
      endpointId: "8596238"
      sceneId: "1659488338"
      scope: private
  profile:                # 单文件 Profile，见 assistant-profile
    enabled: false
    file: assistant.profile.yml
  events:                 # POST /api/assistant/events
    enabled: false
    allowedSources: [homeassistant]
    rateLimitPerMinute: 60
```

| 字段 | 说明 |
|------|------|
| `enabled` | 启用 `data/assistant-jobs.json` 作为定时任务 SSOT |
| `legacyDualWrite` | 写入 assistant-jobs 后是否镜像 `cron-jobs.json`（默认 false） |
| `queue` | JobWorker → TaskQueue：`maxConcurrency`、`maxRetries`、`defaultTimeoutMs` |
| `defaults.notify` | 执行阶段合并的默认 IM 目标；**持久化 JSON 中每条 Job 仍须显式 `notify`** |
| `home` | Home Assistant 别名与 `home_*` 工具，见 [assistant-home](/advanced/assistant-home) |
| `profile` | 单文件 Profile 合并 SOUL/AGENTS/TOOLS，见 [assistant-profile](/advanced/assistant-profile) |
| `events` | 外部 HTTP 事件触发 Job，见 [assistant-events](/advanced/assistant-events) |

持久化任务（`cron-jobs.json` / `assistant-jobs.json`）**必须**含 `notify`；缺字段启动或 CLI 读取时会报错。旧 `context` 已移除。

## 热重载

Zhin.js 支持配置热重载，修改配置文件后自动生效（仅在 `zhin dev` 模式下）。

### 自动重载的配置

- **插件列表** - 添加/删除插件自动重载
- **插件配置** - 修改插件配置自动重载
- **日志级别** - 修改日志级别立即生效

### 需要重启的配置

- **端口号** - 修改 HTTP 端口需要重启
- **数据库连接** - 修改数据库配置需要重启
- **核心服务** - 修改 `services` 列表需要重启

## 完整示例

```yaml
log_level: 1
debug: false

database:
  dialect: sqlite
  filename: ./data/zhin.db

plugin_dirs:
  - node_modules
  - ./src/plugins

services:
  - process
  - config
  - command
  - component
  - permission
  - cron

plugins:
  - my-plugin
  - "@zhin.js/host-router"
  - "@zhin.js/host-api"
  - "@zhin.js/adapter-sandbox"
  - "@zhin.js/adapter-icqq"

endpoints:
  - context: icqq
    name: "${ICQQ_ACCOUNT}"

http:
  port: 8086
  token: ${HTTP_TOKEN}

hostApi:
  enabled: true
  lazyLoad: false

ai:
  providers:
    ollama:
      api: ollama-chat
      host: "http://127.0.0.1:11434"
  agents:
    zhin:
      provider: ollama
      model: qwen3:8b
  trigger:
    respondToAt: true
    respondToPrivate: true
```
