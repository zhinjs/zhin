# @zhin.js/next-agent

下一代 Agent CapabilityIngress。它把 Tool、Skill、Agent、MCP 四个独立 Feature projection 汇合为一次 turn 的 owner-visible 能力视图，不维护 ToolRegistry、SkillRegistry、SubAgentRegistry 或 MCPRegistry。

## 核心接口

```ts
const agent = new AgentRuntime();
agent.attach(root.controller.snapshots);

await agent.runTurn(pluginId, async (capabilities) => {
  const tool = capabilities.tools.find((item) => item.name === 'search');
  return orchestrator.run({
    generation: capabilities.generation,
    tools: capabilities.tools,
    skills: capabilities.skills,
    agents: capabilities.agents,
    mcp: capabilities.mcp,
    execute: (input) => tool?.execute(input),
  });
});
```

`AgentRuntime` 只负责 attach 和 `runTurn()`。模型调用、stream、session、compaction、approval 和安全策略属于上层 orchestrator adapter。

## CapabilityIngress

`CapabilityIngress.read(snapshot, owner)` 从同一个 immutable snapshot 读取：

- `tools`：带 owner-bound `execute()` 的 Tool handles。
- `skills`：完整 Markdown Skill descriptors。
- `agents`：完整 Markdown Agent descriptors。
- `mcp`：带 `listTools()` / `callTool()` 的连接 handles。

缺少某个 Feature projection 时返回空数组，不产生隐式安装要求。nearest-owner override 在各 Feature Index 内完成；Root 能力可被 child 继承，sibling 私有能力不会泄漏。

## Turn Lease

`runTurn()` 在回调前 acquire `SnapshotLease`，在回调 settle 后释放。回调期间提交新 generation 不会替换正在使用的 Tool、Skill、Agent 或 MCP client；下一 turn 才读取新 projection。

执行型 Tool/MCP handle 不能逃逸 turn。回调结束后继续调用会抛出 `Agent capability turn scope has ended`，避免访问已经 retire/dispose 的连接。直接调用 `CapabilityIngress.read()` 时，调用者必须自行持有 snapshot lease。

## 安全与 schema

Tool approval 只是声明。Agent Runtime 不自行弹窗或猜测风险；orchestrator 必须结合 owner policy、Tool metadata 和实际输入执行批准。`inputSchema` 原样交给模型/schema adapter，不强制 Zod。

## 依赖预算

生产依赖只有 Kernel 和四个 workspace Feature。没有 `ai`、Zod、MCP SDK、数据库、YAML、Vite 或平台 SDK。独立 5MB 安装门禁会测量完整 Agent 能力闭包。

## 验证

```bash
pnpm --filter @zhin.js/next-agent test
pnpm --filter @zhin.js/next-agent build
pnpm --filter @zhin.js/next-agent check:size
```
