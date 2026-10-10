---
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/command": patch
"@zhin.js/cli": patch
"@zhin.js/component": patch
"@zhin.js/components": patch
"@zhin.js/core": patch
"@zhin.js/feature-kit": patch
"@zhin.js/game-kit": patch
"@zhin.js/html-renderer": patch
"@zhin.js/jsx": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/middleware": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/scaffold-wizard": patch
"@zhin.js/tailwind": patch
"create-zhin-app": patch
"zhin.js": patch
---

Unify lazy JSX and HTML delivery across commands, inbound middleware and registered components. Remove the former JSX/template component runtimes, respect declared adapter HTML policies, and preserve author/generation ownership for automatic and explicit replies.

Add the optional @zhin.js/components library with composable JSXRenderable display props, shared themes, symmetric spacing and local style/text overrides. Include tables, lists, Markdown with highlighted code blocks, and display-only checkbox, radio, switch and button states; provide a reusable preview gallery. Update scaffolds, examples and public authoring documentation together.

Add optional official Tailwind static-utility compilation to inline styles. Consolidate raster rendering on @pixel.js/shotium, remove the Satori image toolkit, and align raster format contracts with actual PNG/JPEG/WebP results.

Reject cascade-dependent Tailwind values including unset, track the installed Tailwind version in the bundled theme provenance, and preserve both repository and upstream MIT attribution. Keep optional gallery dependency failures visible and document asynchronous Tailwind initialization.
