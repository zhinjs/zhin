# 可靠的开发流程 · 归档约定

本仓库采用 Cursor 技能 **`reliable-dev-workflow`（可靠的开发流程）**：**先脚手架 → 读 `.history`/`.notice` 并对齐代码与消歧 → 用技能包内模板写 `.feature/<slug>/plan`·`todo` → 用户确认后实现 → summary 并更新索引**。

范式 **不绑定 Zhin**；任意仓库可复制 **整个 `reliable-dev-workflow/` 技能目录** 使用。

## 技能与资源包位置

| 路径 | 说明 |
|------|------|
| [`.cursor/skills/reliable-dev-workflow/SKILL.md`](../../.cursor/skills/reliable-dev-workflow/SKILL.md) | 入口（中英文对照总览） |
| [`.cursor/skills/reliable-dev-workflow/templates/`](../../.cursor/skills/reliable-dev-workflow/templates/) | 与 SKILL **同源打包**的模板 |
| [`.cursor/skills/reliable-dev-workflow/scripts/bootstrap.mjs`](../../.cursor/skills/reliable-dev-workflow/scripts/bootstrap.mjs) | **缺索引/auto-init**：仓库根执行 `node .cursor/skills/reliable-dev-workflow/scripts/bootstrap.mjs` |
| [`.cursor/skills/reliable-dev-workflow/references/phases/`](../../.cursor/skills/reliable-dev-workflow/references/phases/) | **按阶段拆开的详细说明** |
| [`.cursor/rules/reliable-dev-workflow.mdc`](../../.cursor/rules/reliable-dev-workflow.mdc) | 常驻规则摘要 |

分发他人：打包 **`.cursor/skills/reliable-dev-workflow/`** 整夹（含 `templates/`、`scripts/`、`references/`）。**豁免、工作根、敏感信息、索引协作**见同包 **[`references/exemptions-and-scope.md`](../../.cursor/skills/reliable-dev-workflow/references/exemptions-and-scope.md)**。

## 仓库内工作产物（约定）

| 目录 | 作用 |
|------|------|
| `.history/`、`index.md` | 历次交付索引与条目 |
| `.notice/`、`index.md` | 持续有效的注意事项 |
| `.feature/<slug>/` | 单次需求：`plan`、`todo`、`summary`（从技能 `templates/` 起步） |

## 与本仓库其它文档的关系

仍以 **[`domain.md`](./domain.md)**、`CONTEXT-MAP.md`、ADR 等为**领域真源**；**可靠的开发流程**只保证**单次交付的可追溯工单与防漂题**。二者互补。
