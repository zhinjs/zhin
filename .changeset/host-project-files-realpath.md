---
"@zhin.js/host-http": patch
---

Resolve Console project file paths through their real filesystem targets. Deny symlink escapes, blocked targets and dangling links for reading, writing, tree discovery and environment file inventory, while retaining allowed internal links.
