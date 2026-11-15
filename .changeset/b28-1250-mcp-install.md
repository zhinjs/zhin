---
"@zhin.js/agent": minor
"@zhin.js/console-protocol": minor
"@zhin.js/host-http": minor
"@zhin.js/gateway": minor
"zhin.js": patch
"@zhin.js/cli": patch
"@zhin.js/scaffold-wizard": patch
---

MCP 状态口径与安装预览（zhinjs/zhin#1250 第 28 批）：

- `mcp-status-not-loaded-contradicts-agent`（根因）：Plugin Runtime 下 `ai.mcpServers` 的服务作为本代（generation）的 MCP 特性运行，在代激活时连接；Agent 的内省却只读自己的 `resourceHub.mcps` 注册表，而这些服务从不进入该表，于是 Console「运行时能力 → MCP 服务」、`zhin status` 都把已连接的 github 显示成「未加载」（`not_loaded`），「需要你处理」也报「未连接」。现在由 `HostMcpStatusBoard` 记录每个配置服务客户端的实际连接结果（跨代保留：被沿用的代仍算已连接，候选代连接失败不影响旧代），内省按它报告：已连接（含工具数）/ 连接失败（附分类原因）/ 尚未连接（`idle`，显示为「待首次使用时连接」）。
- 「需要你处理」只列连接失败的 MCP 服务并附失败原因，标题改为「MCP 服务 … 连接失败」；尚未连接、未加载的服务只在 MCP 页显示。`zhin status` 中 `idle` 显示为「待首次使用时连接」。
- 启动日志 `ready | … | mcp:` 改为与状态一致的写法（如 `github(待连接)`；日志写出时客户端尚未连接），连接结果另记 `mcp_connected`（工具数）/ `mcp_connect_failed`（分类与原因）。
- 新增 MCP 连接测试：`POST {base}/introspection/mcp/test`（body `{ name }`，权限 `agent.configure`，已登记到 `CONSOLE_HTTP_PERMISSIONS`）用一次性客户端连接、列工具后断开，不改变 Agent 自己的连接与行状态；未配置的名字返回 404，同一服务测试进行中返回 409，Agent 未运行返回 503。新增导出：`@zhin.js/console-protocol` 的 `CONSOLE_MCP_TEST_PATH` / `ConsoleMcpConnectTestResult`；`@zhin.js/host-http` 的 `ConsoleAgentIntrospection.testMcp()`；`@zhin.js/agent/runtime` 的 `HostMcpStatusBoard`（`probe()`）及相关类型，`AgentHostIntrospectionPort.testMcpServer()`。
- `install-dry-run-dumps-whole-config`：`zhin install … --dry-run` 的配置预览改为 unified diff，只含改动的行和上下 3 行，由真正写入时（逐键补丁、保留注释与顺序）会产生的文本计算，不再重新序列化打印整份配置（此前注释几乎全部丢失，看起来像安装会抹掉注释）。
- 安装插件时跟随项目的精确版本写法：项目 `dependencies` / `devDependencies` / `optionalDependencies` 里的 `zhin.js` / `@zhin.js/*` 注册表依赖全部是不带 `^` / `~` 等范围的精确版本（`workspace:`、`link:`、`file:`、`catalog:`、`npm:` 别名、git / 路径来源与 `latest` 这类标签不参与判断；至少要有一条注册表依赖）时，`pnpm add` 加 `--save-exact`（npm `--save-exact`，yarn / bun `--exact`）。只对 npm 注册表包生效；`--dry-run` 显示的命令同样带上。`@zhin.js/gateway/plugin-management` 新增 `projectPinsExactZhinVersions()`、`isRegistryPackageRequest()`。
