# @zhin.js/bridge-miao-child

**Bridge v1 — H1（喵崽）一等公民** 的参考 **tracer 子进程**：父进程经 `@zhin.js/bridge-ipc` 下发 `dispatch`，子进程按 **O1 显式插件 allowlist** 动态 `import()` 至少一个最小插件；插件通过 **shim** 调用 `emitOutboundIntent`，子进程写出 **`outbound_intent`** NDJSON，父进程可用 `@zhin.js/bridge-outbound-gate` 做 mock 发送。

## 一等公民与实验性 fork

- **H1（喵崽）**：本包与 IPC 契约、测试与文档以 **喵崽兼容路径** 为一等目标（当前实现为 **最小 tracer**，非完整 Miao 运行时）。
- **其他 Yunzai/Miao fork**：视为 **experimental**；未单独保证行为，接入前请自行验证。

## Q1：用户环境（Node 与依赖）

- 需要 **Node.js**（与仓库 `engines` 一致：`^20.19.0 || >=22.12.0`），且 `process.execPath` 可启动子进程。
- 在本 monorepo 内：在仓库根目录执行 **`pnpm install`**，再 **`pnpm --filter @zhin.js/bridge-miao-child test`**（或根目录 `vitest` 会按 glob 收集 `**/*.test.ts`）。
- **生产 / Q1 真值**：由部署方自备 Node 与依赖安装路径；子进程入口为 **`bin/miao-tracer-child.mjs`**，通过环境变量注入配置（见下）。

## 配置（O1 allowlist）

环境变量 **`ZHIN_BRIDGE_MIAO_CONFIG`**：JSON 字符串。

```json
{
  "pluginAllowlist": ["/absolute/path/to/tracer-echo-plugin.mjs"],
  "glueKey": { "botId": "…", "ecosystem": "…", "instanceId": "…" },
  "context": "miao"
}
```

- **`pluginAllowlist`**：仅加载列表中的路径（经 `realpath` 解析）；每项为 **可 import 的 ESM 模块**，`default` 导出 **类**，且实例实现 **`onBridgeDispatch(payload, api)`**。
- **`glueKey` / `context`**：写入 `outbound_intent.payload`（与 `@zhin.js/bridge-outbound-gate` 校验一致）。

与 **`ZHIN_BRIDGE_IPC_TOKEN`** 一并由父进程注入（见 `@zhin.js/bridge-ipc` / `BridgeSupervisor`）。

## 与「阻断 / 继续链」的关系（喵侧）

ADR [`docs/adr/0008-bridge-v1-nonebot-inbound-chain-dispatch-result.md`](../../docs/adr/0008-bridge-v1-nonebot-inbound-chain-dispatch-result.md) 以 NoneBot 为主叙述；**喵崽 / Yunzai 侧**在 v1 采用等价策略：

- 插件在子进程内的「是否继续匹配下一个插件」等语义 **仅在子进程内生效**；
- 是否停止 zhin **Inbound Runner** 后续节点，**只**由 IPC **`dispatch_result.payload`** 中的 **显式**字段（如 `shortCircuit`）表达；**不得**由父进程从 Miao 内部约定推断。

本 tracer 子进程在完成插件后发送的 `dispatch_result` 默认 **`shortCircuit: false`**（与 ADR v1 默认一致）。

## 测试跳过策略

若需在本地或 CI 中跳过本包 e2e（例如临时隔离子进程相关用例）：

```bash
SKIP_BRIDGE_MIAO_E2E=1 pnpm --filter @zhin.js/bridge-miao-child test
```

本包 **不引入** 喵崽本体 npm 依赖；子进程仅依赖 **Node 内置模块** + 仓库内 **fixtures**。若未来接入真实 Miao 并增加可选原生依赖，应在此 README 补充 **条件跳过** 说明（例如缺少某可选包时 `describe.skipIf(...)`）。
