import { DEFAULT_TOOL_BUDGET } from '../core/turn-progress.js';
import { DEFAULT_INJECTION_GUARD } from '../security/provenance.js';
import { DEFAULT_USAGE_QUOTA } from '../security/usage-quota.js';
import { DEFAULT_TOOL_HARD_GATE } from '../security/tool-hard-gate.js';
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_FOLLOW_UP_MODE, DEFAULT_STEERING_MODE } from '@zhin.js/ai';
import { DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT } from '../context/context-tail-limit.js';
import {
  DEFAULT_ALWAYS_LOADED_TOOLS,
  DEFAULT_DEFERRED_TOOLS_CONFIG,
} from '../tool-catalog/types.js';
import type { ZhinAgentConfig } from './zhin-agent-config.js';
import { DEFAULT_WORKER_BASE_TOOLS } from './zhin-agent-constants.js';

export const DEFAULT_CONFIG = {
  persona: 'You are Zhin, a member of this chat running on Zhin.js. Talk like the people here, act through available tools when needed, and never claim actions or results unless confirmed by tool output.',
  maxIterations: 15,
  timeout: 120_000,
  preExecTimeout: 15_000,
  maxTools: 12,
  contextTailMessageLimit: DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT,
  rateLimit: {},
  toneAwareness: true,
  chatModel: '',
  visionModel: '',
  contextTokens: DEFAULT_CONTEXT_TOKENS,
  maxHistoryShare: 0.5,
  compaction: {
    enabled: true,
    auto: true,
    keepRecentTokens: 20_000,
    minKeepCount: 2,
  },
  disabledTools: [],
  allowedTools: [],
  execSecurity: 'deny',
  execPreset: 'custom',
  execAllowlist: [],
  execApprovalMode: 'auto',
  subagentExecApprovalMode: 'auto',
  maxParallelSubagents: 5,
  toolExecution: 'tiered',
  subagentAutoContinue: true,
  subagentDirectImDelivery: false,
  workerExecApprovalMode: 'auto',
  maxSubagentIterations: 25,
  subagentTurnMode: 'off',
  toolBudget: { ...DEFAULT_TOOL_BUDGET },
  injectionGuard: { ...DEFAULT_INJECTION_GUARD, trustedOutputTools: [] },
  usageQuota: { ...DEFAULT_USAGE_QUOTA },
  toolHardGate: { ...DEFAULT_TOOL_HARD_GATE, dangerousTools: [] },
  subagentTools: [],
  subagentTurnWaitMs: 300_000,
  modelSizeHint: '',
  skillInstructionMaxChars: 0,
  modelHarness: {},
  phaseTrace: false,
  onPhaseTrace: () => {},
  promptTraceVerbose: false,
  recordRequestBodies: true,
  promptCacheRetention: 'in_memory',
  promptCacheKeyPrefix: 'zhin',
  // `alwaysLoadedTools` is left unset on purpose: the resident base set depends on the
  // turn's scene tier (ADR 0042 §2) and is resolved per turn; this field is only the operator's additions.
  deferredTools: {
    maxLoadedPerSession: DEFAULT_DEFERRED_TOOLS_CONFIG.maxLoadedPerSession,
    discoverTopK: DEFAULT_DEFERRED_TOOLS_CONFIG.discoverTopK,
  },
  workerBaseTools: [...DEFAULT_WORKER_BASE_TOOLS],
  steeringMode: DEFAULT_STEERING_MODE,
  followUpMode: DEFAULT_FOLLOW_UP_MODE,
  deferredAutoContinue: false,
  deferredAutoContinueMaxDepth: 8,
  outputSchema: 'segments',
  gitStatus: true,
  contextPaths: [],
  systemPromptMaxChars: 100_000,
  thinkingPreview: false,
  thinkingPreviewMaxLength: 200,
  schedule: {
    budget: {
      maxTokens: 32_000,
      maxToolCalls: 15,
      timeoutMs: 120_000,
    },
    security: {
      execPreset: 'readonly',
      allowedDomains: [],
    },
  },
} as unknown as Required<ZhinAgentConfig>;
