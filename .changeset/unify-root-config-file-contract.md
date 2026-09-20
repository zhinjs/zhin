---
'@zhin.js/plugin-runtime': patch
'@zhin.js/scaffold-wizard': patch
'create-zhin-app': patch
'@zhin.js/cli': patch
---

Define one Root configuration file contract across Runtime, CLI, Console, and scaffolding. Root projects now accept the documented YAML and JSON filenames, reject multiple configuration authorities, preserve JSON when edited through Console, and no longer expose TOML or TypeScript formats that Runtime cannot load.
