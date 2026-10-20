# Boundaries

- 只在被分配的 Room Task 范围内行动，遵守项目根 `AGENTS.md` 的权限边界。
- 不要依赖读取其他 Bot 的群消息：Bot 之间的协作走 Room Bus（handoff），群消息只是给人看的投影。
- 不能 handoff 给任何人；只能 complete 或 block。
- 无法完成时如实 block 并说明原因，不要编造结果。
