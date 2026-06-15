import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, isPhaseTraceEnabled, isPromptTraceEnabled, isPromptCacheEnabled, buildAgentPromptCacheStreamOptions } from '../../src/zhin-agent/config.js';

describe('isPhaseTraceEnabled', () => {
  it('config.phaseTrace=true 时应直接开启', () => {
    expect(isPhaseTraceEnabled({ ...DEFAULT_CONFIG, phaseTrace: true }, {} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('config.phaseTrace=false 但环境变量开启时应开启', () => {
    expect(isPhaseTraceEnabled(
      { ...DEFAULT_CONFIG, phaseTrace: false },
      { ZHIN_AGENT_PHASE_TRACE: '1' } as NodeJS.ProcessEnv,
    )).toBe(true);
  });

  it('配置与环境变量都未开启时应关闭', () => {
    expect(isPhaseTraceEnabled(
      { ...DEFAULT_CONFIG, phaseTrace: false },
      {} as NodeJS.ProcessEnv,
    )).toBe(false);
  });
});

describe('isPromptTraceEnabled', () => {
  it('默认随 phaseTrace 开启', () => {
    expect(isPromptTraceEnabled(
      { ...DEFAULT_CONFIG, phaseTrace: true },
      {} as NodeJS.ProcessEnv,
    )).toBe(true);
  });

  it('可单独用 ZHIN_AGENT_PROMPT_TRACE 开启', () => {
    expect(isPromptTraceEnabled(
      { ...DEFAULT_CONFIG, phaseTrace: false, promptTrace: false },
      { ZHIN_AGENT_PROMPT_TRACE: '1' } as NodeJS.ProcessEnv,
    )).toBe(true);
  });

  it('promptTrace=false 且未设环境变量时应关闭', () => {
    expect(isPromptTraceEnabled(
      { ...DEFAULT_CONFIG, phaseTrace: false, promptTrace: false },
      {} as NodeJS.ProcessEnv,
    )).toBe(false);
  });
});

describe('isPromptCacheEnabled', () => {
  it('未配置时默认开启（supported sdk）', () => {
    expect(isPromptCacheEnabled({}, 'anthropic')).toBe(true);
    expect(isPromptCacheEnabled({}, 'openai')).toBe(true);
    expect(isPromptCacheEnabled({}, 'openai-compatible')).toBe(true);
  });

  it('anthropic / openai / openai-compatible 默认开启', () => {
    expect(isPromptCacheEnabled(DEFAULT_CONFIG, 'anthropic')).toBe(true);
    expect(isPromptCacheEnabled(DEFAULT_CONFIG, 'openai')).toBe(true);
    expect(isPromptCacheEnabled(DEFAULT_CONFIG, 'openai-compatible')).toBe(true);
  });

  it('显式 promptCache: false 或环境变量关闭', () => {
    expect(isPromptCacheEnabled({ promptCache: false }, 'anthropic')).toBe(false);
    expect(isPromptCacheEnabled({}, 'anthropic', { ZHIN_AGENT_PROMPT_CACHE: '0' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('不支持的 sdk 关闭', () => {
    expect(isPromptCacheEnabled(DEFAULT_CONFIG, 'google')).toBe(false);
  });

  it('buildAgentPromptCacheStreamOptions 生成 OpenAI cache key', () => {
    const opts = buildAgentPromptCacheStreamOptions(DEFAULT_CONFIG, {
      modelSdk: 'openai',
      provider: 'aihub',
      modelId: 'Glm-4.7',
      label: 'orchestrator',
    });
    expect(opts.promptCache).toBe(true);
    expect(opts.promptCacheKey).toBe('zhin:orchestrator:aihub:Glm-4.7');
    expect(opts.promptCacheRetention).toBe('in_memory');
  });
});
