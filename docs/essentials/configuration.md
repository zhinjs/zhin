# 配置文件

Zhin.js 在项目根目录自动发现主配置文件，支持 **YAML**（`zhin.config.yml` / `.yaml`）、**JSON**（`zhin.config.json`）和 **TOML**（`zhin.config.toml`）。发现优先级：`.yml` → `.yaml` → `.json` → `.toml`。

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
  - "@zhin.js/http"            # HTTP 服务
  - "@zhin.js/console"         # Web 控制台
  - "@zhin.js/adapter-sandbox" # 终端适配器
  - "@zhin.js/adapter-icqq"   # ICQQ 适配器
  - my-plugin                  # 你的本地插件
```

**注意**：
- npm 插件使用完整包名（如 `@zhin.js/http`）
- 本地插件使用文件名（如 `my-plugin` 对应 `src/plugins/my-plugin.ts`）

## 机器人配置（bots）

`bots` 数组定义了每个平台的机器人实例。每个 bot 通过 `context` 字段关联到对应的适配器：

```yaml
bots:
  # ICQQ (QQ) 机器人
  - context: icqq
    name: "${ICQQ_ACCOUNT}"       # QQ 号
    password: "${ICQQ_PASSWORD}"   # 密码（可选，不填则扫码）
    platform: 5                    # 登录平台
    scope: icqqjs
    data_dir: ./data

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
- 一个适配器可以配置多个 bot（不同账号）

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
  enabled: true                 # 是否启用 AI
  defaultProvider: ollama        # 默认 AI 提供者

  # AI 提供者配置
  providers:
    ollama:
      baseURL: "http://localhost:11434"
      model: "qwen2.5:7b"
    openai:
      apiKey: "${OPENAI_API_KEY}"
      baseURL: "https://api.openai.com/v1"
      model: "gpt-4o-mini"

  # 会话配置
  sessions:
    useDatabase: true           # 使用数据库持久化会话
    maxHistory: 20              # 最大历史消息数
    expireMs: 3600000           # 会话过期时间（毫秒）

  # 上下文管理
  context:
    maxMessagesBeforeSummary: 10  # 触发摘要的消息数
    summaryRetentionDays: 30     # 摘要保留天数

  # 触发配置
  trigger:
    respondToAt: true           # 是否响应 @机器人
    respondToPrivate: true      # 是否响应私聊
    prefixes: ["ai "]           # AI 触发前缀
    ignorePrefixes: ["/", "!"]  # 忽略的前缀（通常是命令前缀）
    timeout: 60000              # AI 处理超时（毫秒）
```

**说明**：
- AI 模块需要配置至少一个 provider 才能工作
- 支持 Ollama（本地模型）、OpenAI、以及其他兼容 OpenAI API 的服务
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

**认证方式**：Token 认证，支持两种传递方式：
- **Header**: `Authorization: Bearer <token>`
- **Query**: `?token=<token>`

以下路径无需认证：
- 包含 `/webhook` 的路径（有自己的签名验证）
- 以 `/health` 结尾的路径

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

配置 Web 管理界面：

```yaml
console:
  enabled: true      # 是否启用控制台
  lazyLoad: false    # 是否延迟加载（开发时建议 false）
```

## 环境变量

Zhin.js 支持在配置文件中通过 `${VAR}` 引用环境变量：

```yaml
# 基础用法
token: ${HTTP_TOKEN}

# 带默认值
port: ${PORT:8086}          # 如果 PORT 未设置，使用 8086
```

在项目根目录的 `.env` 文件中设置：

```bash
HTTP_TOKEN=your_secure_token
ICQQ_ACCOUNT=123456789
ICQQ_PASSWORD=your_qq_password
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
  - "@zhin.js/http"          # HTTP 服务
  - "@zhin.js/plugin-music"  # 音乐插件
```

### 插件级配置

部分插件支持在主配置文件中设置自己的配置，键名为插件名：

```yaml
# HTTP 插件配置
http:
  port: 8086

# 控制台插件配置
console:
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
  - "@zhin.js/http"
  # - "@zhin.js/plugin-music"  # 已禁用
```

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
  - "@zhin.js/http"
  - "@zhin.js/console"
  - "@zhin.js/adapter-sandbox"
  - "@zhin.js/adapter-icqq"

bots:
  - context: icqq
    name: "${ICQQ_ACCOUNT}"
    password: "${ICQQ_PASSWORD}"
    platform: 5
    scope: icqqjs

http:
  port: 8086
  token: ${HTTP_TOKEN}

console:
  enabled: true
  lazyLoad: false

ai:
  enabled: true
  defaultProvider: ollama
  providers:
    ollama:
      baseURL: "http://localhost:11434"
      model: "qwen2.5:7b"
  trigger:
    respondToAt: true
    respondToPrivate: true
```
