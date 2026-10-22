---
"@zhin.js/core": patch
"@zhin.js/cli": patch
---

An outbound payload that fails to render (for example a JSX card given an object as a child) is still rejected without leaking details to chat, but now logs a warning with the reason instead of failing silently. `ZHIN_LOG_LEVEL` / `LOG_LEVEL` now take effect even when the config sets no `log_level`; an empty variable counts as unset.
