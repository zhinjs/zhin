# @zhin.js/skill

Markdown Skill Feature。`skills/<name>/SKILL.md` 是 Skill 的唯一事实源，目录名提供稳定 identity，Markdown 内容作为 immutable instructions 进入 generation snapshot。

## 目录约定

```text
skills/
└── research/
    ├── SKILL.md
    ├── tools/
    │   └── search/
    │       └── index.ts
    ├── helper.md
    └── references/
```

公共 Skill 使用 `skills/<name>/SKILL.md`；Agent 私有 Skill 使用 `agents/<agent>/skills/<name>/SKILL.md`。Skill 的私有 Tool 放在该 Skill 的 `tools/<name>/index.ts`，会自动加入 Skill 的 Tool 白名单；参考资料继续与 Skill 共置。

## Markdown 契约

```markdown
# Research

Prefer primary sources. Record uncertainty and citations.
```

Feature 解析 YAML frontmatter 中的 `description`、`tools`、`platforms`、`scopes`、`permissions`、`keywords`、`tags` 与 `always`，并从模型 instructions 中移除 frontmatter。`name` 若存在必须与目录名一致；没有 description 时使用首个 Markdown heading。

单文件插件可用 `setup({ addSkill })` 直接注册 Markdown：
`addSkill('research', '# Research\n\nPrefer primary sources.')`。内容仍经过同一个
Markdown validator 并进入 SkillIndex。

## Projection

`SkillIndex` 提供：

- `list()`：全树 Skill，包含 owner、qualified name、source 和 instructions。
- `visible(owner)`：owner 可见的 Root/ancestor Skill，nearest owner override 生效（底层索引能力）。
- `get(owner, name)`：按 owner 继承链解析单个 Skill。

Skill definition 没有连接、timer 或 disposer。HMR 替换 Markdown Slot 后原子发布新 projection；进行中的 turn 继续读取旧文本。

## 依赖

只依赖 Plugin Runtime、Feature Kit 与 YAML frontmatter parser，不依赖 AI SDK 或向量数据库。

## 验证

```bash
pnpm --filter @zhin.js/skill test
pnpm --filter @zhin.js/skill build
```
