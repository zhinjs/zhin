# @zhin.js/skill

下一代 Markdown Skill Feature。`skills/<name>/SKILL.md` 是 Skill 的唯一事实源，目录名提供稳定 identity，Markdown 内容作为 immutable instructions 进入 generation snapshot。

## 目录约定

```text
skills/
└── research/
    └── SKILL.md
```

只扫描一级 Skill 目录和其中精确命名的 `SKILL.md`。旧 `agent/skills/*.md`、任意散落 Markdown 和嵌套 Skill 不会被隐式发现。

## Markdown 契约

```markdown
# Research

Prefer primary sources. Record uncertainty and citations.
```

Feature 不解析或重写 Markdown frontmatter；完整文本原样保存为 `instructions`。首个 Markdown heading 用作 description，没有 heading 时回退到目录名。模型 adapter 可以按自身能力解释 Markdown，但不能维护第二份 Skill metadata registry。

## Projection

`SkillIndex` 提供：

- `list()`：全树 Skill，包含 owner、qualified name、source 和 instructions。
- `visible(owner)`：owner 可见的 Root/ancestor Skill，nearest owner override 生效。
- `get(owner, name)`：按 owner 继承链解析单个 Skill。

Skill definition 没有连接、timer 或 disposer。HMR 替换 Markdown Slot 后原子发布新 projection；进行中的 turn 继续读取旧文本。

## 依赖

只依赖 Next Kernel 与 Feature Kit，不依赖 Markdown parser、YAML、AI SDK 或向量数据库。

## 验证

```bash
pnpm --filter @zhin.js/skill test
pnpm --filter @zhin.js/skill build
```
