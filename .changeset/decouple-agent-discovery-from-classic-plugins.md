---
'@zhin.js/agent': patch
'@zhin.js/cli': patch
---

Remove the classic Plugin-tree Agent discovery path. Workspace Agent discovery now accepts only a project root, package Agent surface discovery accepts a filesystem descriptor, and plugin-packaged Agents remain owned by the generation Feature provider.
