---
"@zhin.js/plugin-word-riddle": patch
---

Make package and CI builds deterministic by reusing the committed character-riddle dataset; downloading the upstream CSV now happens only during an explicit `RIDDLE_REFRESH=1` maintainer refresh.
