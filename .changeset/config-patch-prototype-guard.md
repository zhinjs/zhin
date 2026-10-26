---
"@zhin.js/plugin-runtime": patch
---

Config patches now guard every object write and delete against `__proto__`, `constructor` and `prototype` segments, and only walk own properties, so inherited members such as `toString` are treated as missing keys instead of existing values.
