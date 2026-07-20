# @zhin.js/agent-feature

下一代 Markdown Agent Feature。它从 `agents/<name>.agent.md` 构造 immutable Agent definition，不读取旧分形 `agent.ts`、`instructions.md` 或模块级 SubAgent registry。

## 目录约定

```text
agents/
├── planner.agent.md
└── reviewer.agent.md
```

Agent 目录只允许一级、精确 `.agent.md` 后缀。`planner.agent.md` 的 local name 是 `planner`；child Plugin 的 qualified name 自动包含 Plugin instance path。

## Markdown 契约

```markdown
# Planner

Break the request into verifiable steps. Prefer reversible actions.
```

完整 Markdown 是 `instructions` SSOT。首个 heading 作为 description；没有 heading 时使用文件 identity。Feature 不绑定模型、system prompt 模板、tool policy 或 session store，这些属于 orchestrator adapter。

## Projection

`AgentIndex.list()` 返回全树 qualified descriptors；`visible(owner)` 和 `get(owner, name)` 使用 nearest-owner inheritance。不同 Plugin owner 的同名 Agent 不通过扫描顺序覆盖。

Agent definition 是纯数据，没有 runtime disposer。单文件 HMR 只替换 Agent Slot，旧 turn lease 继续使用旧 instructions。

## 依赖

只依赖 Next Kernel 与 Feature Kit，不引入 AI SDK、模型 provider、Markdown/YAML parser 或数据库。

## 验证

```bash
pnpm --filter @zhin.js/agent-feature test
pnpm --filter @zhin.js/agent-feature build
```
