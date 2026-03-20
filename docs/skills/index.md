---
layout: page
sidebar: false
aside: false
---

<div class="skill-page">

# 技能商店

<p class="page-desc">浏览本仓库中的文件化技能：区分「通用模板技能」与「插件自带技能」</p>

<ClientOnly>
<SkillMarket />
</ClientOnly>

## 两类技能

| 类型 | 来源 | Agent 如何发现 | 典型操作 |
|------|------|----------------|----------|
| **通用技能** | `packages/create-zhin/template/skills/` | 复制到项目根 `skills/<name>/`（新建项目模板已带） | 按需编辑 SKILL.md |
| **插件技能** | 各 `plugins/**/skills/<name>/SKILL.md`，随 npm 包发布 | 安装并启用对应插件后，扫描插件包内 `skills/` | 在插件仓库改 SKILL.md 并发版 |

插件技能**不是**通过 `zhin skills add` 安装的 ZIP 技能，而是与插件一起分发的说明文件。

## 如何安装（CLI）

在项目根目录执行：

```bash
# 从线上 registry 搜索（与本文档同源 JSON）
zhin skills search "关键词"

# 仅当 registry 中该条目提供可下载 source（ZIP）时，可安装到当前项目 skills/
zhin skills add <id>

# 安装到用户目录 ~/.zhin/skills
zhin skills add <id> --local

# 本地新建空白技能目录
zhin skills add --new
```

## 目录数据如何更新

构建文档时会运行 `gen-skills`，扫描模板与插件包内的 `SKILL.md`，生成 `docs/public/skills.json`。部署后该文件即为 CLI 默认拉取的 registry。

## 如何贡献技能

1. **通用技能**：向 `packages/create-zhin/template/skills/<name>/SKILL.md` 提 PR（frontmatter 必填 `name`、`description`）。
2. **插件技能**：在对应插件包下维护 `skills/<name>/SKILL.md`，并确保 `package.json` 的 `files` 包含 `skills`。
3. **带 ZIP 的社区技能**：若需支持 `zhin skills add` 一键安装，应在合并流程中向 registry **追加**条目并填写 `source`；注意避免覆盖自动生成的 `skills.json`（建议后续改为「生成结果 + 叠加补丁文件」合并）。

</div>

<style scoped>
.skill-page {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
}

.page-desc {
  text-align: center;
  font-size: 16px;
  color: var(--vp-c-text-2);
  margin: 8px 0 32px;
}

.skill-page h1 {
  text-align: center;
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 4px;
}

.skill-page h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 40px 0 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--vp-c-divider);
}
</style>
