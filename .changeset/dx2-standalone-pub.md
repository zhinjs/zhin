---
"@zhin.js/cli": patch
---

`zhin pub` works inside a standalone plugin (`npx @zhin.js/cli pub`), accepts a plugin directory argument, recognises plugins by their `zhin` manifest, needs `--yes` instead of hanging in non-interactive shells, rejects `private: true`, and `zhin --version` reports the real CLI version. The standalone template README and hints use `npx @zhin.js/cli pub`.
