import { defineAgent } from '@zhin.js/agent';

export default defineAgent({
  description: "代码与设计审查，只读分析，不修改文件或执行 shell",
  role: "reviewer",
  contextMode: "fresh",
  keywords: ["review", "审查", "代码评审"],
  maxIterations: 8,
});
