import { defineAgent } from '@zhin.js/agent';

export default defineAgent({
  description: "五角色调研，检索与核实信息",
  role: "researcher",
  contextMode: "fresh",
  keywords: ["research", "调研", "搜索"],
  maxIterations: 8,
});
