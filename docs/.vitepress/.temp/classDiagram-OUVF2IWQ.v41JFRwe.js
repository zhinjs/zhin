import { s as styles_default, c as classRenderer_v3_unified_default, a as classDiagram_default, C as ClassDB } from "./chunk-V7JOEXUC.C6zMx6ts.js";
import { _ as __name } from "./app.js";
import "./chunk-5VM5RSS4.DfFgMooS.js";
import "./chunk-XXDRQBXY.C_xcOgTI.js";
import "./chunk-VR4S4FIN.B29y2Pyx.js";
import "./chunk-32BRIVSS.tS_IqJod.js";
import "vue/server-renderer";
import "vue";
import "./plugin-vue_export-helper.1tPrXgE0.js";
var diagram = {
  parser: classDiagram_default,
  get db() {
    return new ClassDB();
  },
  renderer: classRenderer_v3_unified_default,
  styles: styles_default,
  init: /* @__PURE__ */ __name((cnf) => {
    if (!cnf.class) {
      cnf.class = {};
    }
    cnf.class.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
  }, "init")
};
export {
  diagram
};
