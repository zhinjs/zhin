# 配置文件

Zhin.js 使用 `zhin.config.yml` 作为主配置文件。这个文件控制机器人的所有行为。

## 配置文件位置

配置文件位于项目根目录：

```
my-bot/
├── zhin.config.yml  ← 配置文件
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

**示例**：开发时设置为 `0`，生产环境设置为 `1` 或 `2`。

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

### 核心服务

启用框架的核心服务：

```yaml
services:
  - process      # 进程管理
  - config       # 配置管理
  - command      # 命令系统
  - component    # 组件系统
  - permission   # 权限管理
  - cron         # 定时任务
```

**说明**：这些是框架的核心功能，通常不需要修改。

### 插件列表

启用要使用的插件：

```yaml
plugins:
  - "@zhin.js/http"            # HTTP 服务
  - "@zhin.js/console"         # Web 控制台
  - "@zhin.js/adapter-sandbox" # 终端适配器
  - my-plugin                  # 你的本地插件
```

**注意**：
- npm 插件使用完整包名（如 `@zhin.js/http`）
- 本地插件使用文件名（如 `my-plugin` 对应 `src/plugins/my-plugin.ts`）

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

## HTTP 服务配置

配置 Web 服务器和 API：

```yaml
http:
  port: 8086                # 端口号
  username: ${username}     # 用户名（从环境变量读取）
  password: ${password}     # 密码（从环境变量读取）
  base: /api               # API 基础路径
```

**环境变量**：

在项目根目录的 `.env` 文件中设置：

```bash
username=admin
password=your_secure_password
```

**为什么使用环境变量？**
- ✅ 安全 - 密码不会提交到 Git
- ✅ 灵活 - 不同环境使用不同配置
- ✅ 标准 - 符合 12-Factor App 原则

**修改端口**：

如果 8086 端口被占用，可以改成其他端口：

```yaml
http:
  port: 3000  # 改成 3000
```

## Web 控制台配置

配置 Web 管理界面：

```yaml
console:
  enabled: true      # 是否启用控制台
  lazyLoad: false    # 是否延迟加载（开发时建议 false）
```

**配置说明**：
- `enabled: true` - 启用 Web 控制台
- `enabled: false` - 禁用 Web 控制台（生产环境可选）
- `lazyLoad: false` - 立即加载（开发推荐）
- `lazyLoad: true` - 延迟加载（节省内存）

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

**说明**：
- 插件名对应文件名（不含 `.ts` 扩展名）
- 支持 TypeScript (`.ts`) 和 JavaScript (`.js`)

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

**官方插件列表**：
- `@zhin.js/http` - HTTP 服务
- `@zhin.js/console` - Web 控制台
- `@zhin.js/plugin-music` - 音乐播放
- `@zhin.js/plugin-github-notify` - GitHub 通知

### 禁用插件

注释掉不需要的插件：

```yaml
plugins:
  - "@zhin.js/http"
  # - "@zhin.js/plugin-music"  # 已禁用
```

或者直接删除该行。

## 热重载

Zhin.js 支持配置热重载，修改配置文件后自动生效。

### 自动重载的配置

- ✅ **插件列表** - 添加/删除插件自动重载
- ✅ **插件配置** - 修改插件配置自动重载
- ✅ **日志级别** - 修改日志级别立即生效

### 需要重启的配置

- ⚠️ **端口号** - 修改 HTTP 端口需要重启
- ⚠️ **数据库连接** - 修改数据库配置需要重启
- ⚠️ **核心服务** - 修改 `services` 列表需要重启

**重启方法**：
```bash
# 停止机器人
Ctrl + C

# 重新启动
pnpm dev
```

## 完整示例

```yaml
log_level: 1

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

http:
  port: 8086
  username: ${username}
  password: ${password}
  base: /api

console:
  enabled: true
  lazyLoad: false
```

