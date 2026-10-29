---
'@zhin.js/cli': patch
---

Release gate: `versionCandidate` no longer treats pure leftover changeset deletions as a generated version tree, so private-package-only entries cannot deadlock publish after a version PR.
