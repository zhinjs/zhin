import { defineAgent } from '@zhin.js/agent';

export default defineAgent({
  description: "Text-to-image only—call generate_image and return a short caption; image delivery is automatic.",
  keywords: ["draw", "画", "生图", "画图", "image generation", "generate_image"],
  maxIterations: 8,
});
