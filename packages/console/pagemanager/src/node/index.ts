/// <reference types="node" />
/** Browser ESM bare-import rewrite + Host React/router proxies (for Plugin Runtime client chunks). */
export {
  ALLOWED_ESM_CANONICAL,
  buildHostProxyModule,
  decodeSpecifierSegment,
  encodeSpecifierSegment,
  getOrBuildCanonicalEsmBundle,
  joinConsolePublicPath,
  rewriteBareImportsForBrowser,
  type HostProxyModuleOptions,
  type RewriteBareImportsOptions,
} from "./esmForBrowser.js";
export {
  CONSOLE_SHARED_MODULE_ISSUE_EVENT,
  CONSOLE_SHARED_MODULE_ISSUES_KEY,
  CONSOLE_SHARED_MODULE_VERSIONS_KEY,
  CONSOLE_UI_MODULE,
  VERSIONED_SHARED_MODULES,
  classifySharedModuleVersion,
  compilePeerRange,
  importedNames,
  peerRangeForPage,
  sharedModuleQuery,
  sharedModuleRequestFromSearchParams,
  type CompiledPeerRange,
  type RangeComparator,
  type SharedModuleRequest,
  type SharedModuleVersionVerdict,
} from "./shared-modules.js";
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
export {
  isConsoleBlueprint,
  projectBlueprintToCliPanel,
  projectBlueprintToImCard,
} from "@zhin.js/console-contract";
