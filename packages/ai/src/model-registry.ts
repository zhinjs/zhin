/**
 * @zhin.js/ai - Model Registry
 * 模型发现、能力检测与本地缓存
 *
 * 启动时通过 Provider API 查询可用模型并持久化到本地 JSON 文件，
 * 二次启动时直接读取缓存，仅在模型列表变化时增量更新详情。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AIProvider, ProviderCapabilities } from './types.js';

// ============================================================================
// Types
// ============================================================================

/** 单个模型的详细信息 */
export interface AIModelInfo {
  /** 模型 ID（如 gpt-4o、qwen2.5:14b） */
  id: string;
  /** 所属 Provider 名称 */
  provider: string;
  /** 上下文窗口大小（token 数）；0 或 undefined 表示未知 */
  contextWindow?: number;
  /** 参数规模（如 "7.6B"、"14B"） */
  parameterSize?: string;
  /** 模型家族（如 "llama"、"qwen2"） */
  family?: string;
  /** 量化级别（如 "Q4_K_M"、"Q8_0"） */
  quantization?: string;
  /** 模型能力列表 (Ollama: ["completion","tools","vision"]) */
  capabilities?: string[];
  /** 缓存时间戳 */
  cachedAt: number;
}

/** 模型选择任务类型 */
export type ModelTask = 'chat' | 'vision' | 'tool_call' | 'summary';

/** 缓存文件结构 */
interface ModelCacheData {
  /** 缓存版本，用于未来迁移 */
  version: 1;
  /** 上次全量发现的时间戳 */
  updatedAt: number;
  /** 按 provider 分组的模型信息 */
  providers: Record<string, AIModelInfo[]>;
}

// ============================================================================
// ModelRegistry
// ============================================================================

export class ModelRegistry {
  private models: Map<string, AIModelInfo[]> = new Map(); // providerName → AIModelInfo[]
  private cachePath: string;

  constructor(dataDir?: string) {
    const dir = dataDir || path.join(process.cwd(), 'data');
    this.cachePath = path.join(dir, 'model-registry-cache.json');
  }

  // ── Cache I/O ─────────────────────────────────────────────────────

  /** 从本地文件加载缓存 */
  loadCache(): boolean {
    try {
      if (!fs.existsSync(this.cachePath)) return false;
      const raw = fs.readFileSync(this.cachePath, 'utf-8');
      const data: ModelCacheData = JSON.parse(raw);
      if (data.version !== 1) return false;
      for (const [provider, models] of Object.entries(data.providers)) {
        this.models.set(provider, models);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** 持久化缓存到本地文件 */
  saveCache(): void {
    const data: ModelCacheData = {
      version: 1,
      updatedAt: Date.now(),
      providers: Object.fromEntries(this.models),
    };
    const dir = path.dirname(this.cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ── Discovery ─────────────────────────────────────────────────────

  /**
   * 发现单个 Provider 的所有可用模型。
   *
   * 1. 调用 provider.listModels() 获取模型 ID 列表
   * 2. 和缓存比对，仅对新模型调用 getModelDetails（增量更新）
   * 3. 更新内存缓存
   */
  async discover(provider: AIProvider): Promise<AIModelInfo[]> {
    const providerName = provider.name;
    let modelIds: string[];
    try {
      modelIds = await (provider.listModels?.() ?? Promise.resolve(provider.models));
    } catch {
      modelIds = provider.models;
    }
    if (!modelIds.length) {
      modelIds = provider.models;
    }

    const cached = this.models.get(providerName) || [];
    const cachedMap = new Map(cached.map(m => [m.id, m]));

    // 找出新模型（缓存中没有的）
    const newIds = modelIds.filter(id => !cachedMap.has(id));
    // 保留仍然存在的缓存
    const retained = cached.filter(m => modelIds.includes(m.id));

    // 对新模型获取详情（如果 provider 有 getModelDetails）
    const newModels: AIModelInfo[] = [];
    for (const id of newIds) {
      const info = await this.fetchModelDetails(provider, id);
      newModels.push(info);
    }

    const all = [...retained, ...newModels];
    this.models.set(providerName, all);
    return all;
  }

  /**
   * 发现所有 Provider 的模型。
   */
  async discoverAll(providers: AIProvider[]): Promise<void> {
    await Promise.all(providers.map(p => this.discover(p)));
  }

  // ── Model Details Fetch ───────────────────────────────────────────

  /** 获取单个模型的详细信息 */
  private async fetchModelDetails(provider: AIProvider, modelId: string): Promise<AIModelInfo> {
    const base: AIModelInfo = {
      id: modelId,
      provider: provider.name,
      cachedAt: Date.now(),
    };

    // Ollama: use /api/show to get rich metadata
    if (provider.name === 'ollama' && 'host' in provider) {
      return this.fetchOllamaModelDetails(provider as any, modelId, base);
    }

    // OpenAI-compatible: infer from model name
    return this.inferFromModelName(base, provider);
  }

  /** Ollama /api/show 获取模型详情 */
  private async fetchOllamaModelDetails(
    provider: { host?: string; name: string } & AIProvider,
    modelId: string,
    base: AIModelInfo,
  ): Promise<AIModelInfo> {
    try {
      const host = (provider as any).host || 'http://localhost:11434';
      const response = await fetch(`${host}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
      });
      if (!response.ok) return base;
      const data = await response.json() as any;

      base.family = data.details?.family;
      base.parameterSize = data.details?.parameter_size;
      base.quantization = data.details?.quantization_level;
      base.capabilities = data.capabilities; // ["completion","tools","vision"] etc.

      // Extract context_length from model_info
      const arch = data.details?.family || '';
      const contextKey = `${arch}.context_length`;
      if (data.model_info?.[contextKey]) {
        base.contextWindow = data.model_info[contextKey];
      }

      return base;
    } catch {
      return base;
    }
  }

  /** 从模型名推断信息（适用于 OpenAI 兼容 API，含 router prefix 格式） */
  private inferFromModelName(info: AIModelInfo, provider: AIProvider): AIModelInfo {
    // 对 router 模型（prefix/model-name），使用 root 部分来推断
    const root = extractModelRoot(info.id).toLowerCase();

    // 推断家族
    if (root.includes('gpt-5') || root.includes('gpt-4') || root.includes('gpt-3')) {
      info.family = root.includes('gpt-5') ? 'gpt-5' : root.includes('gpt-4') ? 'gpt-4' : 'gpt-3.5';
    } else if (/^o[13]/.test(root)) {
      info.family = 'o-series';
    } else if (root.includes('claude')) {
      info.family = 'claude';
    } else if (root.includes('gemini')) {
      info.family = 'gemini';
    } else if (root.includes('qwen')) {
      info.family = 'qwen';
    } else if (root.includes('deepseek')) {
      info.family = 'deepseek';
    } else if (root.includes('llama')) {
      info.family = 'llama';
    } else if (root.includes('gemma')) {
      info.family = 'gemma';
    } else if (root.includes('mistral') || root.includes('mixtral')) {
      info.family = 'mistral';
    } else if (root.includes('grok')) {
      info.family = 'grok';
    } else if (root.includes('kimi')) {
      info.family = 'kimi';
    } else if (root.includes('glm')) {
      info.family = 'glm';
    }

    // 推断上下文窗口
    if (provider.contextWindow) {
      info.contextWindow = provider.contextWindow;
    } else if (root.includes('128k')) info.contextWindow = 128000;
    else if (root.includes('32k')) info.contextWindow = 32000;
    else if (root.includes('8k')) info.contextWindow = 8192;

    // 推断参数规模（从 :14b 等后缀）
    const sizeMatch = root.match(/[:\-_](\d+(?:\.\d+)?)b\b/);
    if (sizeMatch) info.parameterSize = sizeMatch[1] + 'B';

    // 推断能力
    const caps: string[] = ['completion'];
    if (
      root.includes('vision') || root.includes('-vl') || root.includes('vl-') ||
      root.includes('llava') || root.includes('4o') ||
      (root.includes('claude') && !root.includes('haiku'))
    ) {
      caps.push('vision');
    }
    if (root.includes('coder') || root.includes('codex')) {
      caps.push('code');
    }
    // 大多数现代模型都支持工具调用
    if (provider.capabilities?.toolCalling !== false) {
      caps.push('tools');
    }
    info.capabilities = caps;

    return info;
  }

  // ── Model Selection ───────────────────────────────────────────────

  /**
   * 根据任务类型选择最合适的模型。
   *
   * 优先级：
   *  1. 匹配任务所需能力（vision 任务需要 vision 能力）
   *  2. 参数规模越大越好（更强的推理能力）
   *  3. 如果都满足，选上下文窗口最大的
   *
   * @param providerName 指定 provider，默认取第一个
   * @param task 任务类型
   * @param preferredModel 用户显式指定的模型（最高优先级）
   */
  selectModel(
    providerName: string,
    task: ModelTask = 'chat',
    preferredModel?: string,
  ): string | undefined {
    const models = this.models.get(providerName);
    if (!models?.length) return undefined;

    // 用户显式指定
    if (preferredModel) {
      const found = models.find(m => m.id === preferredModel);
      if (found) return found.id;
    }

    // 按任务过滤
    let candidates = models;
    if (task === 'vision') {
      const visionModels = models.filter(m => m.capabilities?.includes('vision'));
      if (visionModels.length) candidates = visionModels;
    } else if (task === 'tool_call') {
      const toolModels = models.filter(m => m.capabilities?.includes('tools'));
      if (toolModels.length) candidates = toolModels;
    }

    // 按参数规模排序（大的优先），tier score 次之，上下文窗口最后
    const sorted = this.rankCandidates(candidates);
    return sorted[0]?.id;
  }

  /**
   * 返回按优先级排序的候选模型列表（用于自动降级）。
   * 第一个是最优选择，后续为降级候选。
   */
  selectModels(
    providerName: string,
    task: ModelTask = 'chat',
    maxCandidates: number = 5,
  ): string[] {
    const models = this.models.get(providerName);
    if (!models?.length) return [];

    let candidates = models;
    if (task === 'vision') {
      const visionModels = models.filter(m => m.capabilities?.includes('vision'));
      if (visionModels.length) candidates = visionModels;
    } else if (task === 'tool_call') {
      const toolModels = models.filter(m => m.capabilities?.includes('tools'));
      if (toolModels.length) candidates = toolModels;
    }

    return this.rankCandidates(candidates)
      .slice(0, maxCandidates)
      .map(m => m.id);
  }

  /** 按 parameterSize → tierScore → contextWindow 排序 */
  private rankCandidates(candidates: AIModelInfo[]): AIModelInfo[] {
    return [...candidates].sort((a, b) => {
      const sizeA = parseParamSize(a.parameterSize);
      const sizeB = parseParamSize(b.parameterSize);
      if (sizeA !== sizeB) return sizeB - sizeA;
      const tierA = computeTierScore(a.id);
      const tierB = computeTierScore(b.id);
      if (tierA !== tierB) return tierB - tierA;
      return (b.contextWindow || 0) - (a.contextWindow || 0);
    });
  }

  // ── Query ─────────────────────────────────────────────────────────

  /** 获取某个 provider 的所有模型信息 */
  getModels(providerName: string): AIModelInfo[] {
    return this.models.get(providerName) || [];
  }

  /** 获取所有 provider 的模型信息 */
  getAllModels(): Map<string, AIModelInfo[]> {
    return new Map(this.models);
  }

  /** 获取单个模型信息 */
  getModel(providerName: string, modelId: string): AIModelInfo | undefined {
    return this.models.get(providerName)?.find(m => m.id === modelId);
  }

  /** 查找支持特定能力的模型 */
  findModelsWithCapability(capability: string, providerName?: string): AIModelInfo[] {
    const result: AIModelInfo[] = [];
    const entries = providerName
      ? [[providerName, this.models.get(providerName) || []] as const]
      : this.models.entries();
    for (const [, models] of entries) {
      for (const m of models) {
        if (m.capabilities?.includes(capability)) result.push(m);
      }
    }
    return result;
  }

  /** 缓存是否为空 */
  isEmpty(): boolean {
    return this.models.size === 0;
  }

  /** 清除缓存 */
  clear(): void {
    this.models.clear();
    try {
      if (fs.existsSync(this.cachePath)) fs.unlinkSync(this.cachePath);
    } catch { /* ignore */ }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** 从 router 模型 ID 中提取实际模型名（去掉 prefix/） */
export function extractModelRoot(modelId: string): string {
  const slashIdx = modelId.indexOf('/');
  return slashIdx >= 0 ? modelId.slice(slashIdx + 1) : modelId;
}

/**
 * 计算模型层级分数（0-100），用于在缺少 parameterSize 时排序。
 * 分数越高表示模型越强。适用于 router 聚合 API 返回的模型列表。
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
  if (root.includes('deepseek') && root.includes('r1')) return 85;
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

/** 解析参数规模字符串为数值（单位: B），用于排序 */
function parseParamSize(size?: string): number {
  if (!size) return 0;
  const match = size.match(/([\d.]+)\s*(B|b)/);
  if (!match) return 0;
  return parseFloat(match[1]);
}
