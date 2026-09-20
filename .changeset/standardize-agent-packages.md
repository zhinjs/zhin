---
"@zhin.js/agent-feature": patch
"@zhin.js/agent": patch
"@zhin.js/feature-kit": patch
"@zhin.js/runtime": patch
"create-zhin-app": patch
"@zhin.js/plugin-lottery": patch
---

Make root `AGENTS.md` the main Agent contract and `agents/<name>/agent.json` plus `system.md`, `boundaries.md`, and `conventions.md` the only named sub-agent authoring shape. Standardize Agent and Skill private Tools, Skills, and Hooks as nested named directories, enforce access predicates and governed Tool activation, and keep supporting-file changes on Agent Slot hot reloads.
