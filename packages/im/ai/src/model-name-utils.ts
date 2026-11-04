/** 从 router 模型 ID 中提取实际模型名（去掉 prefix/） */
export function extractModelRoot(modelId: string): string {
  const slashIdx = modelId.indexOf('/');
  return slashIdx >= 0 ? modelId.slice(slashIdx + 1) : modelId;
}

/**
 * Legacy name-based display heuristic, not verified model capability or a selection policy.
 * Kept as a pure utility for consumers; Provider Profiles never use this score.
 */
export function computeTierScore(modelId: string): number {
  const root = extractModelRoot(modelId).toLowerCase();

  // Aggregate / meta 模型 — 自动选择时最低优先级
  if (['all', 'free', 'default', 'kiro'].includes(root) || root.startsWith('connect')) return 10;

  // GPT family
  if (root.includes('gpt-5')) return 95;
  if (root.includes('gpt-4o')) return 88;
  if (root.includes('gpt-4')) return 85;
  if (root.includes('gpt-3')) return 60;

  // O-series (reasoning)
  if (/^o3/.test(root)) return 92;
  if (/^o1/.test(root)) return 88;

  // Claude family
  if (root.includes('claude') && root.includes('opus')) return 96;
  if (root.includes('claude') && root.includes('sonnet')) {
    if (root.includes('4.6')) return 93;
    if (root.includes('4.5')) return 90;
    return 88;
  }
  if (root.includes('claude') && root.includes('haiku')) return 70;
  if (root.includes('claude')) return 85;

  // Gemini family
  if (root.includes('gemini') && root.includes('pro')) return 88;
  if (root.includes('gemini') && root.includes('flash')) return 75;
  if (root.includes('gemini')) return 80;

  // DeepSeek
  if (root.includes('deepseek') && root.includes('v4-pro')) return 92;
  if (root.includes('deepseek') && root.includes('v4-flash')) return 88;
  if (root.includes('deepseek') && root.includes('r1')) return 85;
  if (root.includes('deepseek') && root.includes('reasoner')) return 86;
  if (root.includes('deepseek')) return 80;

  // Qwen
  if (root.includes('qwen') && root.includes('max')) return 85;
  if (root.includes('qwen') && root.includes('plus')) return 82;
  if (root.includes('qwen') && root.includes('coder')) return 80;
  if (root.includes('qwen')) return 78;

  // Kimi
  if (root.includes('kimi')) return 82;

  // GLM
  if (root.includes('glm')) return 78;

  // Grok
  if (root.includes('grok')) return 80;

  // Mistral / Mixtral
  if (root.includes('mixtral')) return 78;
  if (root.includes('mistral')) return 75;

  // LLaMA
  if (root.includes('llama')) return 75;

  // Gemma
  if (root.includes('gemma')) return 70;

  // Dedicated vision/coder models (provider-specific, e.g. qw/vision-model)
  if (root.includes('vision-model') || root.includes('coder-model')) return 78;

  // Unknown — moderate default
  return 50;
}
