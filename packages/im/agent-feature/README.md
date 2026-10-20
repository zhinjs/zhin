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
        │   └── schema-validator/
        │       └── index.ts
        ├── skills/
        │   └── db-migration/
        │       ├── SKILL.md
        │       └── tools/
        │           └── schema-check/
        │               └── index.ts
        ├── hooks/
        │   └── audit/
        │       └── index.ts
        └── knowledge/
            └── internal-architecture.md
```

`agents/<name>` 必须使用小写 kebab-case。四个核心文件缺一不可；`workflows/`、`tools/`、`skills/`、`hooks/`、`knowledge/` 可省略。`entry_points` 决定提示词的组合顺序，并且必须包含三个核心 Markdown 文件。

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
  "permissions": ["role(developer)"]
}
```

`system.md` 定义身份与任务，`boundaries.md` 定义权限和行为边界，`conventions.md` 只扩展、具象化根 `AGENTS.md`。反复出现的项目坑应补充到 `conventions.md`。

`workflows/` 与 `knowledge/` 进入 Agent 指令；`tools/<name>/index.ts` 是由 `@zhin.js/tool` 校验、审批和审计的私有 Tool；`skills/<name>/SKILL.md` 是由 `@zhin.js/skill` 投影的私有 Skill。目录结构只声明归属，不绕过 Feature 准入。

## Projection 与热重载

`AgentIndex.list()` 返回全树 qualified descriptors；`visible(owner)` 和 `get(owner, name)` 使用 nearest-owner inheritance。Agent 的 manifest、入口文件及资源文件变化只替换对应 Slot，进行中的 turn 继续使用原 generation。

## 验证

```bash
pnpm --filter @zhin.js/agent-feature test
pnpm --filter @zhin.js/agent-feature build
```
