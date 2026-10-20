---
"@zhin.js/game-kit": patch
---

`messageFromCommandInput` reads the structured Runtime `Message.sender` (`{ id, name }`). Previously the object was stringified, so every player in a multi-player game became the same `[object Object]` user. A bare sender id string is still accepted.
