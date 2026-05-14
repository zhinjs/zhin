# Bridge v1 开发者指南（DX）

面向维护者与集成方：**Q1 为真值**（用户自备 Python / Node、路径与进程模型、token 由环境注入）；**不**宣称 zhin 内置下载或托管解释器。实现细节与入站链语义见 [ADR 0008：NoneBot 与 zhin 入站链](../adr/0008-bridge-v1-nonebot-inbound-chain-dispatch-result.md)；总览与路线图见父 issue [zhin#404](https://github.com/zhinjs/zhin/issues/404)。

## 包一览

| 包名 | 职责 |
|------|------|
| [`@zhin.js/bridge-ipc`](https://github.com/zhinjs/zhin/tree/main/packages/bridge-ipc) | 父↔子 **NDJSON stdio**：`hello` / `hello_ok`、业务帧（如 `dispatch`、`dispatch_result`、`outbound_intent`）。 |
| [`@zhin.js/bridge-supervisor`](https://github.com/zhinjs/zhin/tree/main/packages/bridge-supervisor) | 每 **glue 实例**（`botId` + `ecosystem` + `instanceId`）一个子进程；握手失败 / IPC 致命错误后 **S1** 禁用直至显式 `restart` 或进程重启。 |
| [`@zhin.js/bridge-inbound-glue`](https://github.com/zhinjs/zhin/tree/main/packages/bridge-inbound-glue) | 入站：`Message` → `dispatch`，等待 `dispatch_result`，写入 carrier（`shortCircuit` / `handled` 等）；可选 **circuit** 触发 supervisor 重启。 |
| [`@zhin.js/bridge-outbound-gate`](https://github.com/zhinjs/zhin/tree/main/packages/bridge-outbound-gate) | 子进程 **`outbound_intent`**：校验 payload、策略与限流，再映射到 Core 发送路径（与 #408 等出站工作衔接）。 |
| [`bridge-nonebot-child`](https://github.com/zhinjs/zhin/tree/main/packages/bridge-nonebot-child) | **Python** 参考子进程：真实 NoneBot2 + Console headless + O1 插件 allowlist；用于 **#411** 路径的 Vitest e2e。 |
| [`@zhin.js/bridge-miao-child`](https://github.com/zhinjs/zhin/tree/main/packages/bridge-miao-child) | **Node** 参考子进程（喵崽兼容向 tracer）；**#412** 路径与 `SKIP_BRIDGE_MIAO_E2E`。 |

仓库根目录开发时：`pnpm install` 后可用 `pnpm --filter <包名> test` 等（见各包 README）。

## Q1：用户自备 Python / Node

- **Python（NoneBot 胶水）**：由部署方提供 **≥ 3.9** 与依赖（NoneBot2、`nonebot-adapter-console` 等）。父进程 **不** vendor NoneBot。推荐在 `packages/bridge-nonebot-child` 下执行 **`uv sync`**，或 `python3 -m venv .venv` + `pip install -r requirements.txt`。
- **Node（喵崽 tracer 等）**：与仓库 `engines` 一致；生产环境自备 Node 与安装路径，子进程入口例如 `bridge-miao-child` 的 `bin/miao-tracer-child.mjs`（见该包 README）。

## Token 与环境变量（摘要）

| 变量 / 机制 | 说明 |
|-------------|------|
| **`ZHIN_BRIDGE_IPC_TOKEN`** | `BridgeParentSession.spawn` 默认写入子进程 env 的握手密钥；子进程从该变量读取并与父进程 J2 `hello` 对齐。可通过 `tokenEnvKey` 改用其他 env 名。 |
| **父进程 `BridgeGlueStartSpec.token`** | 实际参与握手的字符串；通常由 `readTokenFromEnv('YOUR_NAME')` 或配置插值在启动前解析，**勿**提交到仓库。 |
| 计划中的 **`bridge_glue.instances[].token_env`** | 见 [bridge-supervisor README](https://github.com/zhinjs/zhin/blob/main/packages/bridge-supervisor/README.md) 的 YAML 草图；运行时解析为 token 字符串再传入 `start`。 |
| **NoneBot 子进程** | 另见 `ZHIN_BRIDGE_NB_PLUGIN_MODULES`、`ZHIN_BRIDGE_GLUE_BOT_ID`、`ZHIN_BRIDGE_GLUE_ECOSYSTEM`、`ZHIN_BRIDGE_GLUE_INSTANCE_ID` 等（[bridge-nonebot-child README](https://github.com/zhinjs/zhin/blob/main/packages/bridge-nonebot-child/README.md)）。 |
| **喵崽 tracer** | `ZHIN_BRIDGE_MIAO_CONFIG`（JSON）、与 `ZHIN_BRIDGE_IPC_TOKEN` 一并注入（[bridge-miao-child README](https://github.com/zhinjs/zhin/blob/main/packages/bridge-miao-child/README.md)）。 |
| **`ZHIN_BRIDGE_TMP`** | 入站 glue **M1** 二进制 spillover 临时目录备选（见 inbound-glue README）。 |

## Inbound Runner / Message Dispatcher / 根中间件（F2）

胶水通过 **`createBridgeGlueMiddleware`** 挂在 **根中间件** 上。`runInboundMessage` 中顺序为：根中间件 → 内层 `next()`（含 **Message Dispatcher**）。词汇对齐见 Core 仓库内 [`packages/core/CONTEXT.md`](https://github.com/zhinjs/zhin/blob/main/packages/core/CONTEXT.md)（**Inbound Runner**、**Message Dispatcher** 等）。ADR 与实现建议：将 glue **注册在列表偏后**（更靠近 `dispatch`），使子进程 **`shortCircuit`** 只影响该中间件 **`next()` 之后**的下游节点。详见 [ADR 0008](../adr/0008-bridge-v1-nonebot-inbound-chain-dispatch-result.md) 与 [bridge-inbound-glue README（Inbound runner placement）](https://github.com/zhinjs/zhin/blob/main/packages/bridge-inbound-glue/README.md)。

## 运行 e2e 测试（uv / pip）

### NoneBot 路径（#411）

1. 在仓库根执行 `pnpm install`。
2. `cd packages/bridge-nonebot-child && uv sync`（或 venv + `pip install -r requirements.txt`）。
3. 运行 glue 包测试（任选其一）：

```bash
pnpm --filter @zhin.js/bridge-inbound-glue test
# 或只跑 NB 子进程 e2e：
pnpm exec vitest run --config vitest.config.ts packages/bridge-inbound-glue/src/nonebot-child.e2e.test.ts
```

测试文件 `nonebot-child.e2e.test.ts` 在 **无法** 用 `uv run`（自仓库根，见探测逻辑）或 `packages/bridge-nonebot-child/.venv` 下的 Python **import** `nonebot` 与 `nonebot.adapters.console` 时，使用 **`it.skipIf`** 跳过整例（**无**单独 `SKIP_BRIDGE_NB_*` 类环境变量；未装依赖时属于预期跳过）。错误提示里可能写作「nonebot2 + nonebot-adapter-console」，与 PyPI 包名一致；import 路径仍为 `nonebot` / `nonebot.adapters.console`。

### 喵崽 tracer 路径（#412）

```bash
pnpm --filter @zhin.js/bridge-miao-child test
```

若需在 CI 或本地**显式跳过**该包中的 e2e 类用例：

```bash
SKIP_BRIDGE_MIAO_E2E=1 pnpm --filter @zhin.js/bridge-miao-child test
```

## 脚手架与可选 Compose

- **配置片段与目录提示**（非可执行密钥）：[examples/bridge-scaffold](https://github.com/zhinjs/zhin/tree/main/examples/bridge-scaffold)（克隆仓库后见 `examples/bridge-scaffold/README.md`）。
- **可选 Docker Compose**（非 v1 阻塞、非 CI 依赖）：[examples/bridge-compose](https://github.com/zhinjs/zhin/tree/main/examples/bridge-compose)。

## 相关跟踪

- DX 交付：[GitHub #413](https://github.com/zhinjs/zhin/issues/413)
- 父 PRD / 路线图：[GitHub #404](https://github.com/zhinjs/zhin/issues/404)
