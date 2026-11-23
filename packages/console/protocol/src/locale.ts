/**
 * Display language of the Console wire and of browser Console packages (#1250 batch 77).
 *
 * The one browser-side declaration: it is the same union as `Locale` of `@zhin.js/plugin-runtime`
 * (a type test keeps them equal), declared here because this package stays zero-dependency so
 * browsers, both Hosts and external Console builds can share it without a runtime package.
 */
export type ConsoleLocale = 'zh-CN' | 'en';
