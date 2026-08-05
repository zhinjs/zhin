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
