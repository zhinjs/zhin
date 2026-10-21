---
"@zhin.js/runtime": patch
"@zhin.js/cli": patch
---

Make the plugin config source conflict actionable. When a trusted plugin declares both `definePlugin({ config })` and a root `schema.json`, startup still stops (Zhin never picks one), and the error now names the entry file and the `schema.json` path and explains which file to delete for each choice. `zhin new` templates keep `schema.json` as their only config source and say so in `plugin.ts` and the README.
