import { defineAgent } from '@zhin.js/agent';

export default defineAgent({
  description: "五角色协调者，拆解目标并编排子任务",
  role: "planner",
  contextMode: "fresh",
  keywords: ["plan", "规划", "协调"],
  maxIterations: 10,
});
