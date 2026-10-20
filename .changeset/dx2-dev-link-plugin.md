---
"@zhin.js/cli": patch
---

`zhin dev link <plugin-dir>` connects a standalone plugin to a bot for hot-reload development: links it under `plugins/`, declares `./plugins/<instance>`, and points the plugin's own `zhin.js` / `@zhin.js/*` at the bot's copies; `zhin dev unlink <instance>` reverts exactly that.
