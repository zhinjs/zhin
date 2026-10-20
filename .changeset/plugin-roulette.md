---
"@zhin.js/plugin-roulette": patch
---

New game: Russian roulette (`轮盘` / `roulette`) for game-hub. Players join a lobby, take turns pulling the trigger on a cylinder with one bullet, and whoever is shot loses; turn and lobby timeouts are enforced by a schedule job, and results feed `战绩` / `排行 轮盘`. Groups can opt in to muting the loser; support is read from the Endpoint's declared `muteGroupMember` capability, so platforms that cannot mute only keep score.
