---
'@zhin.js/cli': patch
---

Add `zhin dev link <zhin-path>` / `zhin dev unlink`: switch an external plugin project to a local zhin checkout by packing the full workspace dependency closure and overriding every package, so each zhin package resolves to a single instance. `zhin doctor` gains a "Zhin 包单实例" check that detects duplicate zhin package instances and suggests `zhin dev link`.
