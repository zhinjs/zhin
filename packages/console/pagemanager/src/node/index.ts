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
