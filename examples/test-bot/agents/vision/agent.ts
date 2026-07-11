import { defineAgent } from '@zhin.js/agent';

export default defineAgent({
  description: "Inbound image analysis—describe, OCR, answer what is visible.",
  keywords: ["image", "vision", "OCR"],
  maxIterations: 8,
});
