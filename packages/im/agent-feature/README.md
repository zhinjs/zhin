# @zhin.js/agent-feature

目录化子 Agent Feature。主 Agent 使用插件根目录的标准 `AGENTS.md`；命名子 Agent 使用 `agents/<name>/` 自包含模块。运行时只识别 `agent.json`，不扫描单文件 `.agent.md`、`agent.ts` 或 `instructions.md`。

## 目录约定

```text
my-plugin/
├── AGENTS.md
└── agents/
    └── backend-engineer/
        ├── agent.json
        ├── system.md
        ├── boundaries.md
        ├── conventions.md
        ├── workflows/
        │   └── create-api.md
        ├── tools/
        │   ├── schema-validator.sh
        │   └── README.md
        └── knowledge/
            └── internal-architecture.md
```

`agents/<name>` 必须使用小写 kebab-case。四个核心文件缺一不可；`workflows/`、`tools/`、`knowledge/` 可省略。`entry_points` 决定提示词的组合顺序，并且必须包含三个核心 Markdown 文件。

```json
{
  "name": "Backend Engineer Agent",
  "version": "1.0.0",
  "description": "负责后端业务逻辑与 API 设计",
  "trigger_rules": {
    "file_patterns": ["src/backend/**", "database/**"],
    "keywords": ["api", "service", "migration"]
  },
  "entry_points": ["system.md", "boundaries.md", "conventions.md"],
  "tools": ["schema-validator"],
  "permissions": ["role(developer)"]
}
```

`system.md` 定义身份与任务，`boundaries.md` 定义权限和行为边界，`conventions.md` 只扩展、具象化根 `AGENTS.md`。反复出现的项目坑应补充到 `conventions.md`。

`workflows/`、`tools/`、`knowledge/` 会作为结构化资源进入 Agent definition。目录中的脚本不会直接变成可执行 Tool；Agent 仍须经受控的 `bash` 或显式 `@zhin.js/tool` capability 执行，因此不能绕过 Tool 准入、审批和审计。

## Projection 与热重载

`AgentIndex.list()` 返回全树 qualified descriptors；`visible(owner)` 和 `get(owner, name)` 使用 nearest-owner inheritance。Agent 的 manifest、入口文件及资源文件变化只替换对应 Slot，进行中的 turn 继续使用原 generation。

## 验证

```bash
pnpm --filter @zhin.js/agent-feature test
pnpm --filter @zhin.js/agent-feature build
```
