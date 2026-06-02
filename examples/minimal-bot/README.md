# minimal-bot（Stable 黄金路径）

Zhin.js **对外默认承诺**的最小示例：`bots: []`（Sandbox 由 Console 打开沙盒页时自动创建）、最少插件、关闭 `toolSearch` 与 MCP。

维护者全功能配置见 [`../test-bot`](../test-bot/)（厨房水槽）。

## 前置条件

- 在**仓库根目录**已执行 `pnpm install` 并完成 `pnpm build`（或至少构建 logger / cli / core / zhin / 本示例依赖的 adapters）。
- Node.js ^20.19.0 或 >=22.12.0，pnpm 9+。

## 30 分钟首跑

```bash
# 仓库根
cd /path/to/zhin
pnpm install

cd examples/minimal-bot
cp .env.example .env
pnpm dev
```

1. 确认终端里 Host 已启动（日志会给出监听地址，一般为 `http://127.0.0.1:8086`）。
2. 打开 **[Remote Console](https://console.zhin.dev)**（或本地 [zhin-console](https://github.com/zhinjs/zhin-console) 开发服，通常 `http://127.0.0.1:5173`）。
3. 登录时 **API Base** 填与日志一致的 Host 地址（如 `http://127.0.0.1:8086`），**Token** 与 `.env` 中 `HTTP_TOKEN` 一致（默认 `minimal-dev-token`）。
4. 在 Console 侧栏打开 **沙盒** 页（连接建立后自动创建 Sandbox bot），发送 `hello` → 应收到插件回复。
5. （可选）本地 [Ollama](https://ollama.com/) 运行后发送 `ai: 你好` 触发 AI 回合。

详见 [docs/console-remote.md](../../docs/console-remote.md)。

### 无 Ollama 时

仅验证 IM Stable 路径：步骤 2 即可。AI 需 Ollama 或配置 `OPENAI_API_KEY` 并将 `zhin.config.yml` 中 `ai.defaultProvider` 改为 `openai` 且补充 `providers.openai`。

## 配置说明

| 项 | 值 |
|----|-----|
| `bots` | `[]`（Sandbox 在 Console 沙盒页连接时自动创建，一般无需写 `context: sandbox`） |
| Plugins | adapter-sandbox、host-router、host-api、hello |
| `ai.agent.toolSearch` | `false`（Advanced 能力在 test-bot 验证） |

## 验收

```bash
# 仓库根
pnpm check:stable
```

与 [`../test-bot/ACCEPTANCE.md`](../test-bot/ACCEPTANCE.md) 中 **Stable** 段一致；Advanced 项请勿在本目录期望通过。
