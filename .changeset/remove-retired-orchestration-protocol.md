---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
"zhin.js": patch
---

Remove the retired `tool_search` and `run_deferred_task` orchestration protocol from the Agent and CLI. `discover`, `load_tool`, and `spawn_task` are now the only documented and executable orchestration vocabulary; obsolete config migration, result formatting, prompt redaction, reserved names, subagent filtering, and the detached class-based tool are removed. Config repair now preserves canonical `ai.agent` fields while removing retired model fields.
