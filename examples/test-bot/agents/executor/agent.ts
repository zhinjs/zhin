import { defineAgent } from '@zhin.js/agent';

export default defineAgent({
  description: "五角色执行，按方案落地改动",
  role: "executor",
  contextMode: "fresh",
  keywords: ["execute", "执行", "实现"],
  maxIterations: 10,
});
