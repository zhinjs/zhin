---
"@zhin.js/agent": minor
"@zhin.js/runtime": minor
"@zhin.js/tool": minor
"create-zhin-app": minor
"@zhin.js/adapter-dingtalk": minor
"@zhin.js/adapter-discord": minor
"@zhin.js/adapter-github": minor
"@zhin.js/adapter-icqq": minor
"@zhin.js/adapter-kook": minor
"@zhin.js/adapter-lark": minor
"@zhin.js/adapter-line": minor
"@zhin.js/adapter-napcat": minor
"@zhin.js/adapter-onebot11": minor
"@zhin.js/adapter-qq": minor
"@zhin.js/adapter-slack": minor
"@zhin.js/adapter-telegram": minor
"@zhin.js/adapter-wecom": minor
"@zhin.js/process-monitor": minor
"@zhin.js/plugin-60s": minor
"@zhin.js/plugin-code-runner": minor
"@zhin.js/plugin-group-suite": minor
"@zhin.js/plugin-lottery": minor
"@zhin.js/plugin-music": minor
"@zhin.js/plugin-qrcode": minor
"@zhin.js/plugin-rss": minor
"@zhin.js/plugin-short-url": minor
---

Use `agent/tools/$*.ts` and `defineAgentTool` from `@zhin.js/tool` as the sole Agent Tool authoring model. Remove the duplicate `@zhin.js/agent/tools` definition, context, bridge, export, and discovery path; migrate plugin manifests, examples, scaffolding, HMR, and prepack compilation to the generation-owned Tool Feature.
