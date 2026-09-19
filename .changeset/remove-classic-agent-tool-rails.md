---
"@zhin.js/agent": minor
"@zhin.js/cli": patch
"zhin.js": minor
---

Remove the remaining classic Agent Tool rail and the unmounted `install_skill` and retired `activate_skill` protocols. Skill loading now uses the polymorphic `SkillInstructionSource` contract and typed read results, `spawn_task` owns its explicit turn-bound definition, and Web, file, orchestration, spawn, and Skill modules replace the former catch-all `builtin` directory. Remove the unused ToolSelection collector and its compatibility exports so the generation Tool catalog remains the only production selection path.
