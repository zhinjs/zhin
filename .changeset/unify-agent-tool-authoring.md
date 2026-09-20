---
"@zhin.js/agent": patch
"@zhin.js/runtime": patch
"@zhin.js/tool": patch
"create-zhin-app": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/process-monitor": patch
"@zhin.js/plugin-60s": patch
"@zhin.js/plugin-code-runner": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-lottery": patch
"@zhin.js/plugin-music": patch
"@zhin.js/plugin-qrcode": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-short-url": patch
---

Use `tools/<name>/index.ts` and `defineAgentTool` from `@zhin.js/tool` as the sole Agent Tool authoring model. Remove the duplicate `@zhin.js/tools` definition, context, bridge, export, and discovery path; migrate plugin manifests, examples, scaffolding, HMR, and prepack compilation to the generation-owned Tool Feature.
