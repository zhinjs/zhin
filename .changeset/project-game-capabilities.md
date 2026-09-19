---
'@zhin.js/game-kit': minor
'@zhin.js/plugin-blackjack': patch
'@zhin.js/plugin-dice-duel': patch
'@zhin.js/plugin-dungeon-expedition': patch
'@zhin.js/plugin-guess-number': patch
'@zhin.js/plugin-game-hub': patch
'@zhin.js/plugin-idiom-chain': patch
'@zhin.js/plugin-rps': patch
'@zhin.js/plugin-text-adventure': patch
'@zhin.js/plugin-tic-tac-toe': patch
'@zhin.js/plugin-word-riddle': patch
---

Replace the process-global game registry and implicit current database with a generation-owned Game Feature projection. Each game now publishes a typed Game capability with its own record port, while the hub reads the atomic GameIndex from the active operation snapshot.

This removes setup-order routing, cross-Root state, HMR registration stacks, and the legacy GameKit singleton APIs.
