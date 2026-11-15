---
"@zhin.js/agent": minor
"create-zhin-app": patch
"zhin.js": patch
"@zhin.js/gateway": patch
"@zhin.js/cli": patch
---

技能与知识库的可发现性（#1250 第 27 批）：

- `skill-catalog-drops-triggers`：系统提示的 `## Available skills` 目录不再每条只留描述第一句的前 40 个字符。每条保留第一句、`Use when …` 句、`Triggers:` 触发词和 SKILL.md frontmatter 的 `keywords`（格式 `- name: 说明 | Use when … | Triggers: …`；单个触发词 / 关键词超过 32 字符丢弃）；截断改为整个目录共用约 4000 字符预算（单条最多 320 字符），超出时先截说明，再截 `Use when`，触发词最后截。toolSearch 编排层的技能目录（`skillsSummaryXML` / 技能注册表）用同一格式和预算，XML 里可选的 `<keywords>` 也会列出。脚手架的 `github` 技能此前在目录里只剩 `Prepare GitHub issues, pull requests,…`，「帮我写一个 PR 描述」现在能在目录里对上 `PR 描述`。
- 公开技能的 `keywords` 命中当前消息时，在本条消息的运行时尾部加一句「建议加载技能 X」（`## Suggested skill`），只是提示，不自动激活：按关键词自动激活仍只用于 Agent 私有技能，因为公开技能是第三方说明，激活会注入正文并解锁它的工具。缓存前缀不变。为防关键词堆砌，只看每个技能前 12 个关键词、按命中的最长一个计分，忽略单字、不足 3 个字符的英文词、常见寒暄与虚词。新增 `suggestPublicSkillsForIntent()`，`buildCapabilityContext()` 新增可选参数 `intent`。
- `knowledge-search-not-advertised`：配置了 `ai.knowledge.baseDir`、且本回合的 `knowledge_search` 对所有发送者都可用（没有权限或机器人角色限制）时，系统提示附一段知识库索引（`## Knowledge base`：文件名与一、二级标题，约 1500 字符以内，先舍二级标题再舍文件），并写明关于本机器人、本项目的问题先查知识库。索引排在稳定段末尾、scene 之前（知识库变化只让它之后的缓存失效），段上限 2000 字符；只放标题和路径，去掉 Markdown 与尖括号、逐项截断，放在 `<knowledge_index>` 里标注为数据；与检索共用缓存，目录文件变化时失效。上下文预算新增 `knowledge_index` 段（`zhin trace` 显示为「知识库索引」，网关用量统计计入固定段）。`KnowledgeIndex` 新增可选 `outline()`。
- `knowledge_search` 的工具描述与 `query` 参数说明改写；不带空格的中文问题按字的二元组部分匹配，计分前去掉「怎么、可以、这个、一下、知道、我想……」等虚词，不会靠虚词命中无关文档。标题抽取按 CommonMark 处理围栏（闭合围栏后面只能有空白）。
- 知识库目录视为 owner 可信内容：与 `skills/` 一样列入受保护目录，Agent 的文件写入工具写到这里每次都要真人批准。
- 脚手架模板（`create-zhin-app`）：技能的中文触发词同时写进 `keywords`，`skill-creator` 说明了目录保留哪些部分。
