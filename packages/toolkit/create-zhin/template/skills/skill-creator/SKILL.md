---
name: skill-creator
description: "Create or improve Zhin Agent skills (SKILL.md). Use when asked to add a skill, write SKILL.md, document a repeatable agent workflow, or refine skill frontmatter/keywords. Triggers: 创建技能, 写 SKILL, skill-creator, 加 skill."
keywords:
  - skill
  - SKILL.md
  - agent skill
  - workflow
  - 创建技能
tags:
  - agent
  - skills
  - documentation
---

# Skill Creator

为 Zhin Agent 编写或改进 `skills/<name>/SKILL.md`：一条可重复、可搜索、可执行的工作流，而不是长篇手册。

## 何时使用

- 用户要「给 Agent 加一个技能 / 写 SKILL.md / 补 keywords」
- 插件已暴露工具，需要说明**何时激活、按什么步骤用**
- 不要用来实现插件业务逻辑（用 `plugin-develop`）

## 工作流

### 第 1 步：界定单任务边界

1. 输入：用户描述的可重复任务（一次对话应能完成）
2. 输出：技能名（kebab-case）、一句话触发场景
3. 若任务跨「开发 + 发布 + 审计」→ 拆成多个 skill，不要一个 SKILL 包全部

### 第 2 步：写 frontmatter

```yaml
---
name: my-skill          # 与目录名一致，kebab-case
description: "一句话：做什么 + 何时用 + 英文/中文触发词"
keywords:
  - 中文触发词
  - english trigger
tags:
  - zhin
  - plugin
---
```

- `description` 必须包含：**能力**、**触发场景**、**典型用户说法**
- 禁止在 description 末尾加「灵活应用」「视情况而定」等空话

### 第 3 步：写正文（最小结构）

1. **何时使用 / 不适用**（各 3–5 条以内）
2. **编号工作流**（每步写清输入 → 动作 → 输出）
3. **失败与兜底**（if 失败 → 则…，至少 2 条）
4. **不要做什么**（反例 3–5 条）
5. 示例仅在有歧义时添加（命令原文、路径格式）

### 第 4 步：落盘与发现链

- 路径：`skills/<name>/SKILL.md`（插件内则为 `plugins/<pkg>/skills/<name>/SKILL.md`）
- 确认 `package.json` 的 `files` 包含 `skills`
- Agent 发现顺序见 `docs/advanced/tools-skills.md`

### 第 5 步：自检

- [ ] 名称与目录一致
- [ ] keywords/tags 覆盖用户口语
- [ ] 步骤可逐步执行，无「酌情处理」堆砌
- [ ] 有失败分支与反例清单
- [ ] `description` ≤1024 字符且无空话尾巴

### 第 6 步：输出最小可用 skill（模板）

落盘时默认生成如下结构（按任务替换 `...`）：

```markdown
---
name: my-skill
description: "做 X；在用户说 Y 或 Z 时使用。Triggers: ..."
keywords: [中文触发, english-trigger]
tags: [zhin, plugin]
---

# My Skill

## 何时使用
- ...

## 工作流
### 第 1 步：...
- 输入：...
- 输出：...

## 失败与兜底
| 触发条件 | 一线处理 | 仍失败 |
| ... | ... | ... |

## 🔴 CHECKPOINT · ...
...

## 不要做什么
- ...
```

插件内路径：`plugins/<pkg>/skills/<name>/SKILL.md`；用户项目：`skills/<name>/SKILL.md`。

## 失败与兜底

| 触发条件 | 一线处理 | 仍失败 |
|----------|----------|--------|
| Agent 从不激活该 skill | 补 description 与 keywords；检查是否与别的 skill 重复 | 缩短 skill，只保留一个主任务 |
| skill 与工具描述重复 | skill 写流程与约束；工具写参数与副作用 | 删除冗余 skill，只留 `keywords` 在 tool 上 |
| 正文过长模型不读 | 删背景知识，链到 `references/` 或官方文档 URL | 拆成两个 skill |

## 🔴 CHECKPOINT · 发布前

向用户确认：技能名、触发词、是否与其他 skill 重复，再写入仓库。

## 不要做什么

- 不要把整个框架文档贴进 SKILL.md
- 不要写仅适用于某一 IDE 的安装路径（保持 runtime-neutral）
- 不要用 skill 替代 README（安装配置留给 README）
- 不要一个 skill 覆盖「开发+测试+发布」全流程
- 不要在正文堆大量无编号段落

## 延伸阅读

| 文档 | 路径 |
|------|------|
| 发现链与 Tool 关系 | `docs/advanced/tools-skills.md` |
| Agent 扫描实现 | `packages/im/agent/src/discovery/` |
| 官方 skill 范例 | `.github/skills/zhin-plugin-standard-development/SKILL.md` |
