export interface ModelPromptStrategy {
  readonly family: string;
  readonly contextWindowThreshold: number;
  readonly preferConcise: boolean;
  readonly detailedToolInstructions: boolean;
  readonly detailedSecurityRules: boolean;
  readonly maxPromptChars: number;
  readonly style: 'concise' | 'balanced' | 'detailed';
}

export const DEFAULT_STRATEGY: ModelPromptStrategy = Object.freeze({
  family: 'unknown',
  contextWindowThreshold: 128000,
  preferConcise: true,
  detailedToolInstructions: true,
  detailedSecurityRules: true,
  maxPromptChars: 80000,
  style: 'balanced',
});

const MODEL_STRATEGIES: ReadonlyArray<readonly [pattern: RegExp, strategy: Partial<ModelPromptStrategy>]> = [
  [/gpt-?5/i, {
    family: 'gpt-5',
    contextWindowThreshold: 200000,
    preferConcise: false,
    maxPromptChars: 100000,
    style: 'detailed',
  }],
  [/gpt-?4o/i, {
    family: 'gpt-4o',
    contextWindowThreshold: 128000,
    preferConcise: true,
    maxPromptChars: 80000,
    style: 'balanced',
  }],
  [/claude.*opus/i, {
    family: 'claude-opus',
    contextWindowThreshold: 200000,
    preferConcise: false,
    maxPromptChars: 100000,
    style: 'detailed',
  }],
  [/claude.*sonnet/i, {
    family: 'claude-sonnet',
    contextWindowThreshold: 200000,
    preferConcise: true,
    maxPromptChars: 80000,
    style: 'balanced',
  }],
  [/claude.*haiku/i, {
    family: 'claude-haiku',
    contextWindowThreshold: 200000,
    preferConcise: true,
    detailedToolInstructions: false,
    detailedSecurityRules: false,
    maxPromptChars: 40000,
    style: 'concise',
  }],
  [/deepseek/i, {
    family: 'deepseek',
    contextWindowThreshold: 128000,
    preferConcise: true,
    detailedSecurityRules: false,
    maxPromptChars: 60000,
    style: 'balanced',
  }],
  [/mimo/i, {
    family: 'mimo',
    contextWindowThreshold: 32768,
    preferConcise: true,
    detailedToolInstructions: false,
    detailedSecurityRules: false,
    maxPromptChars: 24000,
    style: 'concise',
  }],
  [/nemotron/i, {
    family: 'nemotron',
    contextWindowThreshold: 32768,
    preferConcise: true,
    detailedSecurityRules: false,
    maxPromptChars: 24000,
    style: 'concise',
  }],
  [/glm/i, {
    family: 'glm',
    contextWindowThreshold: 128000,
    preferConcise: true,
    detailedSecurityRules: false,
    maxPromptChars: 60000,
    style: 'balanced',
  }],
  [/agnes/i, {
    family: 'agnes',
    contextWindowThreshold: 128000,
    preferConcise: true,
    maxPromptChars: 60000,
    style: 'balanced',
  }],
  [/step[- ]?\d/i, {
    family: 'step',
    contextWindowThreshold: 128000,
    preferConcise: true,
    maxPromptChars: 60000,
    style: 'balanced',
  }],
  [/magistral/i, {
    family: 'magistral',
    contextWindowThreshold: 128000,
    preferConcise: true,
    maxPromptChars: 60000,
    style: 'balanced',
  }],
  [/codestral/i, {
    family: 'codestral',
    contextWindowThreshold: 32768,
    preferConcise: true,
    detailedSecurityRules: false,
    maxPromptChars: 24000,
    style: 'concise',
  }],
  [/gemini/i, {
    family: 'gemini',
    contextWindowThreshold: 1000000,
    preferConcise: false,
    maxPromptChars: 100000,
    style: 'detailed',
  }],
  [/qwen/i, {
    family: 'qwen',
    contextWindowThreshold: 128000,
    preferConcise: true,
    detailedSecurityRules: false,
    maxPromptChars: 60000,
    style: 'balanced',
  }],
  [/llama/i, {
    family: 'llama',
    contextWindowThreshold: 8192,
    preferConcise: true,
    detailedToolInstructions: false,
    detailedSecurityRules: false,
    maxPromptChars: 30000,
    style: 'concise',
  }],
  [/gemma/i, {
    family: 'gemma',
    contextWindowThreshold: 8192,
    preferConcise: true,
    detailedToolInstructions: false,
    detailedSecurityRules: false,
    maxPromptChars: 30000,
    style: 'concise',
  }],
  [/intern/i, {
    family: 'intern',
    contextWindowThreshold: 32768,
    preferConcise: true,
    detailedToolInstructions: false,
    detailedSecurityRules: false,
    maxPromptChars: 24000,
    style: 'concise',
  }],
  [/flux|schnell/i, {
    family: 'flux',
    contextWindowThreshold: 4096,
    preferConcise: true,
    detailedToolInstructions: false,
    detailedSecurityRules: false,
    maxPromptChars: 8000,
    style: 'concise',
  }],
];

export function resolveModelStrategy(modelId: string): ModelPromptStrategy {
  const root = modelId.includes('/') ? modelId.slice(modelId.indexOf('/') + 1) : modelId;
  for (const [pattern, partial] of MODEL_STRATEGIES) {
    if (pattern.test(root)) {
      return { ...DEFAULT_STRATEGY, ...partial };
    }
  }
  return DEFAULT_STRATEGY;
}
