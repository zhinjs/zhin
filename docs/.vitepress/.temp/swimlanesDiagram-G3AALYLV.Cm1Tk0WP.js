import { c as createFlowDiagram, s as styles_default } from "./chunk-PUDLZKDR.CvEVUkPd.js";
import { _ as __name } from "./app.js";
import "./chunk-5VM5RSS4.DfFgMooS.js";
import "./chunk-XXDRQBXY.C_xcOgTI.js";
import "./chunk-VR4S4FIN.B29y2Pyx.js";
import "./chunk-32BRIVSS.tS_IqJod.js";
import "./channel.CH4WEbyL.js";
import "vue/server-renderer";
import "vue";
import "./plugin-vue_export-helper.1tPrXgE0.js";
var getStyles = /* @__PURE__ */ __name((options) => `${styles_default(options)}
  .swimlane.cluster rect {
    stroke: ${options.clusterBorder} !important;
  }
  [data-look="neo"].cluster rect {
    filter: none;
  }
`, "getStyles");
var styles_default2 = getStyles;
var diagram = createFlowDiagram({ defaultLayout: "swimlane", styles: styles_default2 });
export {
  diagram
};
