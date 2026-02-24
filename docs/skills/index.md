---
layout: page
sidebar: false
aside: false
---

<div class="skill-page">

# 技能商店

<p class="page-desc">搜索并安装 AI 技能到本地，扩展机器人的能力</p>

<ClientOnly>
<SkillMarket />
</ClientOnly>

## 如何安装

在项目根目录或任意目录下执行：

```bash
# 从云端搜索（需先有 registry）
zhin skills search "关键词"

# 按 id 或 name 安装到当前项目 skills/
zhin skills add <id>

# 安装到用户目录 ~/.zhin/skills
zhin skills add <id> --local
```

## 如何贡献技能

1. **推荐**：在仓库的技能目录（如 `docs/public/skills/`）下新建技能文件夹，包含 `SKILL.md`（必填 frontmatter：name、description），提 PR。合并后由脚本或 CI 生成 registry。
2. **自托管**：PR 只修改 `docs/public/skills.json`，新增一条并填写 `source`（ZIP 下载地址），确保 ZIP 内包含 `SKILL.md`。

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
