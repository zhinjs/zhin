/// <reference types="node" />
/** Browser ESM bare-import rewrite + Host React/router proxies (for Plugin Runtime client chunks). */
export {
  ALLOWED_ESM_CANONICAL,
  decodeSpecifierSegment,
  encodeSpecifierSegment,
  getOrBuildCanonicalEsmBundle,
  joinConsolePublicPath,
  rewriteBareImportsForBrowser,
} from "./esmForBrowser.js";
export {
  BASE_STYLE,
  renderConsoleIndex,
  renderPageShell,
  type ConsoleIndexPage,
  type PageShellDescriptor,
} from "../shell/page-renderer.js";
export {
  escapeHtml,
  inferPageCategory,
  pageModuleScript,
  sandboxFallbackScript,
  standaloneTokenBootstrapScript,
} from "../shell/page-renderer-helpers.js";
