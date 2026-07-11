import { defineAgent } from '@zhin.js/agent';

export default defineAgent({
  description: "五角色评估，基于事实设计方案",
  role: "evaluator",
  contextMode: "fresh",
  keywords: ["evaluate", "评估", "方案"],
  maxIterations: 8,
});
