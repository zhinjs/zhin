---
title: API Reference
---

# API Reference generated from source

The API Reference reads Zhin's public authoring entries, Host contracts, and JSDoc directly. Signatures, generics, source locations, and deprecation markers are regenerated with every documentation build.

<a class="api-reference-link" href="/api/index.html" target="_blank" rel="noopener">Open the complete API Reference →</a>

## Choose the right layer

| Goal | Start with |
| --- | --- |
| Define a plugin | `zhin.js` |
| Author commands | `zhin.js/command` |
| Build an Adapter | `zhin.js/adapter` |
| Author components | `zhin.js/component` |
| Author middleware | `zhin.js/middleware` |
| Author handlers | `zhin.js/handler` |
| Author Agent Tools | `@zhin.js/tool`; `agent/tools/` may also import from `zhin.js/agent` |
| Parse Skill Markdown | `@zhin.js/skill` |
| Inject Prompt Sections | `@zhin.js/prompt-section` (experimental) |
| Use database, scheduling, and cross-platform messaging Hosts | `databaseHostToken`, `scheduleHostToken`, and `outboundHostToken` from `zhin.js` |
| Register HTTP / WebSocket routes | `httpHostToken` from `@zhin.js/host-http` |
| Integrate with the IM message gateway | `messageGatewayToken` from `zhin.js/core/runtime` |
| Register Agent capability resources | `AgentResourceHub` from `zhin.js/agent` (experimental) |

The reference answers “what is the signature?” Guides answer “how should these pieces work together?” Start with [plugin authoring](/en/authoring/define-plugin) and use the [Public API surface](/en/contributing/public-api-surface) for stability guarantees.

## Maintenance contract

Run `pnpm docs:api` to generate the site and `pnpm check:api-docs` for type and comment validation. Unknown JSDoc tags, broken symbol links, and TypeScript errors fail the gate.

The generator accepts only authoring entries and Host contracts promised by the Public API SSOT. Exported internals such as `*Index`, repositories, Root Runtime mechanisms, parsers, and assembly helpers are not published as user APIs. A reflection allowlist fails CI whenever the public surface drifts.

Generated files live in `docs/public/api` and are not committed. The GitHub Pages workflow runs `pnpm docs:build`, which generates the reference before VitePress publishes both sites.

<style>
.api-reference-link {
  display: inline-flex;
  margin: 8px 0 20px;
  padding: 10px 16px;
  border-radius: 8px;
  color: white !important;
  font-weight: 700;
  text-decoration: none !important;
  background: var(--vp-c-brand-1);
}
.api-reference-link:hover { background: var(--vp-c-brand-2); }
</style>
