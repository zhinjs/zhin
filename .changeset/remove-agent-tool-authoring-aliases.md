---
'@zhin.js/agent': minor
---

Remove the ambiguous `defineTool` and `DefineToolInput` aliases from the Agent authoring surface. Explicit `agent/tools/$*.ts` entries now use the single canonical `defineAgentTool` and `DefineAgentToolInput` API.
