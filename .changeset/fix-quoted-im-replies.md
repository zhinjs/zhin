---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
---

fix: 未配置 outputSchema 时不再对 AI SDK `result.output` 做 JSON.stringify，避免 IM 回复出现整段双引号与字面量 `\n`（#590）；出站侧额外解开误包的 JSON 字符串层
