---
"@zhin.js/plugin-runtime": patch
"@zhin.js/scaffold-wizard": patch
"@zhin.js/cli": patch
"create-zhin-app": patch
---

Make the instance-keyed `zhin.config.*#plugins` map a shared Plugin Runtime contract. Runtime startup helpers, Console configuration, onboarding, setup, install/uninstall, dependency diagnosis, and scaffolding now reject legacy package-name arrays instead of ignoring or promoting them; only the explicit migration pipeline reads that old shape. Remove the legacy `normalizePluginsMap` authoring API and dead create-project configuration reader, then add a repository gate that prevents compatibility branches from returning to normal configuration paths.
