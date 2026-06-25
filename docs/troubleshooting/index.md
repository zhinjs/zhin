# 疑难排查

遇到问题先在项目根运行：

```bash
npx zhin doctor
```

能自动修的项目可以运行：

```bash
npx zhin doctor --fix
```

## Remote Console 连接失败

**症状**

- Console 登录页提示无法连接 API Base。
- Sandbox 页无法连接。
- 浏览器控制台出现 CORS 或 401。

**检查**

1. `pnpm dev` 是否仍在运行。
2. API Base 是否是 Host 地址，例如 `http://127.0.0.1:8086`。
3. Token 是否来自项目 `.env` 的 `HTTP_TOKEN`。
4. `zhin.config.yml` 的 `plugins` 是否包含：

```yaml
plugins:
  - "@zhin.js/host-router"
  - "@zhin.js/host-api"
```

5. `http.corsOrigins` 是否包含：

```yaml
http:
  corsOrigins:
    - "https://console.zhin.dev"
```

**修复**

```bash
npx zhin doctor --fix
pnpm dev
```

## Sandbox 页不可用

**症状**

- Console 能登录，但没有 Sandbox 入口或连接后没有 bot。

**检查**

`plugins` 需要包含：

```yaml
plugins:
  - "@zhin.js/adapter-sandbox"
```

首跑项目可以保持：

```yaml
endpoints: []
```

Sandbox Endpoint 会在 Console 连接时自动创建。

**修复**

```bash
npx zhin install @zhin.js/adapter-sandbox
pnpm dev
```

## 端口 8086 被占用

**症状**

- 启动时报端口占用。
- `zhin doctor` 提示端口 8086 已被占用。

**修复**

结束旧进程，或换端口：

```yaml
http:
  port: 8090
```

换端口后 Console 的 API Base 也要改成 `http://127.0.0.1:8090`。

## AI 已启用但依赖缺失

**症状**

- 配置里有 `ai:`，启动时报找不到 `@zhin.js/agent`、`ai`、`zod` 或 `@ai-sdk/*`。

**修复**

```bash
npx zhin doctor
```

按输出的 `pnpm add ...` 安装缺失依赖，或重新运行向导：

```bash
npx zhin setup --ai
pnpm install
```

首跑默认不启用 AI。建议先跑通 Sandbox，再启用 AI。

## 语音 / HTML 转图 optional peer 缺失

**症状**

- 配置了 `speech:` 或 `ai.multimodal.audio.strategy: transcribe`，语音仍是占位文本。
- `segment.html()` 出站变成纯文本，日志提示未安装 `@zhin.js/html-renderer`。

**修复**

```bash
npx zhin doctor          # 检查 @zhin.js/speech / @zhin.js/html-renderer
npx zhin doctor --fix    # 写入 package.json 缺失项
pnpm install
pnpm dev
```

详见 [AI 内容链](/advanced/ai-content-chain) 与 [Install tiers](/getting-started/#install-tierszhinjs-4x)。

## 插件安装后不生效

**症状**

- `pnpm add` 成功，但命令或适配器没有出现。
- 插件代码存在，但热重载没有加载。

**检查**

插件必须写入 `zhin.config.yml` 的 `plugins`：

```yaml
plugins:
  - "@scope/plugin"
```

**修复**

使用 Zhin CLI 安装，它会默认自动启用插件：

```bash
npx zhin install @scope/plugin
```

只想预览改动：

```bash
npx zhin install @scope/plugin --dry-run
```

只安装不改配置：

```bash
npx zhin install @scope/plugin --no-enable
```

## TypeScript 导入报错

**症状**

- 本地文件导入在运行或构建时报错。

**原因**

Zhin 项目使用 ESM，TypeScript 本地导入通常要写 `.js` 后缀：

```ts
import { helper } from './helper.js'
```

## `usePlugin()` 或 `getPlugin()` 报上下文错误

**规则**

- `usePlugin()` 必须在模块顶层调用。
- `getPlugin()` 只能在插件初始化/装配阶段调用。
- 命令 action、中间件、工具 execute、事件回调里不要调用 `getPlugin()`。

**推荐写法**

```ts
import { usePlugin, MessageCommand } from 'zhin.js'

const plugin = usePlugin()
const { addCommand, logger } = plugin

addCommand(new MessageCommand('hi').action(() => {
  logger.info('hi command')
  return 'hi'
}))
```

## 仍然卡住

请带上这些信息提 issue：

- `node -v`
- `pnpm -v`
- `npx zhin doctor` 输出
- `zhin.config.yml` 中的 `plugins`、`http`、相关 adapter/AI 配置
- 启动日志中第一条 error
