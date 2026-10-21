---
"@zhin.js/command": patch
"@zhin.js/tool": patch
"@zhin.js/cli": patch
---

Type the plugin config in convention commands and tools without losing inference (#857). `defineCommand<Config>()({...})` fixes the config type and still infers `params`, `options` and the result; `defineAgentTool<Config>()({...})` (or `defineAgentTool<Config>()<Input>({...})` with a JSON Schema) does the same for tools. The returned definer can be shared across a plugin's files. The existing forms are unchanged: `defineCommand({...})`, `defineCommand<Config>({...})` (whose `params` still fall back to `Record<string, CommandParameterValue>`, because TypeScript has no partial type-argument inference) and `defineAgentTool<Input, Result, Config>({...})`. To get `params` inferred together with a typed config, change `defineCommand<Config>({` to `defineCommand<Config>()({`.

`zhin new` normal plugins now declare an `echoPrefix` option in `schema.json` and a matching `<Name>Config` type in `src/index.ts`, and use it in the echo command through `defineCommand<<Name>Config>()`; the generated tests cover the typed config.
