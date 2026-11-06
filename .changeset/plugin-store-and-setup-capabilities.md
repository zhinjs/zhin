---
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-earthquake": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-repeater": patch
"@zhin.js/plugin-runtime": patch
"zhin.js": patch
---

Add generation-scoped `definePluginStore` (`PluginStore`), `Scope.get()`, declarative `PluginSetupCapabilities` return in `definePlugin()`, and `JsonSerializable<T>` typing on `PluginStateStore` to eliminate `as never` casts on TypeScript interfaces.
