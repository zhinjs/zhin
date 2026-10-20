# zhin-console list / object form fix

> **Target repo**: [zhinjs/console](https://github.com/zhinjs/console) (a.k.a. zhin-console), **not** this monorepo.
> UI path inside that repo: `console-ui/src/components/PluginConfigForm/…`
> (or the package's equivalent after any rename — patch was generated against `console-ui/`).

## Why this patch exists

Host-side `jsonSchemaToConsoleSchema` (this monorepo, `basic/cli` /
`console-api-installer`) dual-emits object maps as:

```json
{ "type": "object", "object": {…}, "dict": {…}, "properties": {…} }
```

and list fields as:

```json
{ "type": "list", "inner": { "type": "object", "object": {…} } }
```

Older zhin-console form renderers only read `field.dict || field.properties`
and had no `list` / `array` case for nested object items — so `endpoints[]`
schemas rendered as a blank card with no add/remove controls.

## Apply

```bash
# from a checkout of https://github.com/zhinjs/console
git apply /path/to/zhin/.patches/zhin-console-list-form.patch
# or:
patch -p1 < /path/to/zhin/.patches/zhin-console-list-form.patch
```

Then run that repo's tests / manual smoke:

1. Open Config tab for a multi-endpoint adapter (icqq / sandbox).
2. Expand `endpoints` → fields (name, …) visible.
3. Add / remove endpoint rows; Save writes under `plugins.<key>`.

## Status in zhin monorepo

- Host dual-emit: **landed** (`jsonSchemaToConsoleSchema`).
- Client form renderers: **out of tree** — must land in zhin-console.
- Do not re-implement PluginConfigForm here; `@zhin.js/client` is SDK-only
  (see `packages/console/client/package.json` description).
