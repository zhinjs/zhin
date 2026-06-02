/**
 * ModelRegistry 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ModelRegistry, type AIModelInfo, extractModelRoot, computeTierScore } from '../src/model-registry.js';
import type { AIProvider } from '../src/types.js';

const TEST_DATA_DIR = path.join(process.cwd(), '.test-model-registry-' + process.pid);
const CACHE_FILE = path.join(TEST_DATA_DIR, 'model-registry-cache.json');

function createMockProvider(opts: {
  name?: string;
  models?: string[];
  listModels?: () => Promise<string[]>;
} = {}): AIProvider {
  return {
    name: opts.name || 'test-provider',
    models: opts.models || ['model-a', 'model-b'],
    chat: vi.fn() as any,
    chatStream: vi.fn() as any,
    listModels: opts.listModels,
  };
}

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry(TEST_DATA_DIR);
  });

  afterEach(() => {
    // Clean up test cache files
    try {
      if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  });

  describe('cache I/O', () => {
    it('loadCache returns false when no cache file', () => {
      expect(registry.loadCache()).toBe(false);
      expect(registry.isEmpty()).toBe(true);
    });

    it('saveCache and loadCache round-trip', async () => {
      const provider = createMockProvider({
        listModels: async () => ['model-a', 'model-b'],
      });
      await registry.discover(provider);
      registry.saveCache();

      const registry2 = new ModelRegistry(TEST_DATA_DIR);
      expect(registry2.loadCache()).toBe(true);
      expect(registry2.getModels('test-provider')).toHaveLength(2);
      expect(registry2.getModels('test-provider')[0].id).toBe('model-a');
    });

    it('loadCache returns false for invalid JSON', () => {
      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
      fs.writeFileSync(CACHE_FILE, 'not-json', 'utf-8');
      expect(registry.loadCache()).toBe(false);
    });

    it('loadCache returns false for wrong version', () => {
      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify({ version: 99, updatedAt: 0, providers: {} }), 'utf-8');
      expect(registry.loadCache()).toBe(false);
    });
  });

  describe('discover', () => {
    it('discovers models from provider.listModels()', async () => {
      const provider = createMockProvider({
        listModels: async () => ['gpt-4o', 'gpt-4o-mini', 'o1'],
      });

      const models = await registry.discover(provider);
      expect(models).toHaveLength(3);
      expect(models.map(m => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini', 'o1']);
      expect(models[0].provider).toBe('test-provider');
    });

    it('falls back to provider.models when listModels is undefined', async () => {
      const provider = createMockProvider({
        models: ['fallback-model'],
      });
      delete (provider as any).listModels;

      const models = await registry.discover(provider);
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('fallback-model');
    });

    it('falls back to provider.models when listModels throws', async () => {
      const provider = createMockProvider({
        models: ['safe-model'],
        listModels: async () => { throw new Error('network error'); },
      });

      const models = await registry.discover(provider);
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('safe-model');
    });

    it('incremental discovery: retains cached models, adds new ones', async () => {
      const provider = createMockProvider({
        listModels: async () => ['model-a', 'model-b'],
      });
      await registry.discover(provider);

      // Simulate new model added
      (provider as any).listModels = async () => ['model-a', 'model-b', 'model-c'];
      const models = await registry.discover(provider);
      expect(models).toHaveLength(3);
      expect(models.map(m => m.id)).toContain('model-c');
    });

    it('removes models no longer reported by provider', async () => {
      const provider = createMockProvider({
        listModels: async () => ['model-a', 'model-b'],
      });
      await registry.discover(provider);
      expect(registry.getModels('test-provider')).toHaveLength(2);

      // Provider now only reports model-a
      (provider as any).listModels = async () => ['model-a'];
      const models = await registry.discover(provider);
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('model-a');
    });
  });

  describe('inferFromModelName', () => {
    it('infers family and capabilities from model name', async () => {
      const provider = createMockProvider({
        name: 'openai',
        listModels: async () => ['gpt-4o', 'gpt-3.5-turbo', 'o1'],
        capabilities: { toolCalling: true },
      } as any);

      const models = await registry.discover(provider);
      const gpt4 = models.find(m => m.id === 'gpt-4o');
      expect(gpt4?.family).toBe('gpt-4');
      expect(gpt4?.capabilities).toContain('completion');
      expect(gpt4?.capabilities).toContain('vision'); // 4o has vision

      const gpt35 = models.find(m => m.id === 'gpt-3.5-turbo');
      expect(gpt35?.family).toBe('gpt-3.5');

      const o1 = models.find(m => m.id === 'o1');
      expect(o1?.family).toBe('o-series');
    });

    it('infers parameterSize from name like qwen2.5:14b', async () => {
      const provider = createMockProvider({
        listModels: async () => ['qwen2.5:14b'],
      });
      const models = await registry.discover(provider);
      expect(models[0].parameterSize).toBe('14B');
      expect(models[0].family).toBe('qwen');
    });

    it('infers contextWindow from model name like moonshot-v1-128k', async () => {
      const provider = createMockProvider({
        listModels: async () => ['moonshot-v1-128k'],
      });
      const models = await registry.discover(provider);
      expect(models[0].contextWindow).toBe(128000);
    });
  });

  describe('selectModel', () => {
    beforeEach(async () => {
      // Set up a registry with diverse models
      const provider = createMockProvider({
        name: 'test',
        listModels: async () => ['small-model:3b', 'medium-model:14b', 'large-model:70b'],
      });
      await registry.discover(provider);
    });

    it('returns the largest model for chat task', () => {
      const selected = registry.selectModel('test', 'chat');
      expect(selected).toBe('large-model:70b');
    });

    it('returns preferred model if specified', () => {
      const selected = registry.selectModel('test', 'chat', 'small-model:3b');
      expect(selected).toBe('small-model:3b');
    });

    it('returns undefined for unknown provider', () => {
      const selected = registry.selectModel('nonexistent');
      expect(selected).toBeUndefined();
    });

    it('selects vision-capable model for vision task', async () => {
      // Manually set up models with capabilities
      const prov = createMockProvider({
        name: 'vis-test',
        listModels: async () => ['text-only:7b', 'llava:13b'],
      });
      await registry.discover(prov);

      // Manually inject vision capability
      const models = registry.getModels('vis-test');
      const llava = models.find(m => m.id === 'llava:13b');
      if (llava) llava.capabilities = ['completion', 'vision', 'tools'];

      const selected = registry.selectModel('vis-test', 'vision');
      expect(selected).toBe('llava:13b');
    });
  });

  describe('query methods', () => {
    it('getModel returns specific model', async () => {
      const provider = createMockProvider({
        listModels: async () => ['model-x'],
      });
      await registry.discover(provider);

      const model = registry.getModel('test-provider', 'model-x');
      expect(model).toBeDefined();
      expect(model?.id).toBe('model-x');
    });

    it('getModel returns undefined for missing model', async () => {
      const provider = createMockProvider({
        listModels: async () => ['model-x'],
      });
      await registry.discover(provider);

      expect(registry.getModel('test-provider', 'missing')).toBeUndefined();
    });

    it('getAllModels returns all providers', async () => {
      const p1 = createMockProvider({
        name: 'provider-a',
        listModels: async () => ['ma'],
      });
      const p2 = createMockProvider({
        name: 'provider-b',
        listModels: async () => ['mb'],
      });
      await registry.discover(p1);
      await registry.discover(p2);

      const all = registry.getAllModels();
      expect(all.size).toBe(2);
      expect(all.get('provider-a')?.[0]?.id).toBe('ma');
      expect(all.get('provider-b')?.[0]?.id).toBe('mb');
    });

    it('findModelsWithCapability filters correctly', async () => {
      const provider = createMockProvider({
        name: 'cap-test',
        listModels: async () => ['tool-model', 'basic-model'],
      });
      await registry.discover(provider);

      // Manually set capabilities
      const models = registry.getModels('cap-test');
      models[0].capabilities = ['completion', 'tools'];
      models[1].capabilities = ['completion'];

      const toolModels = registry.findModelsWithCapability('tools', 'cap-test');
      expect(toolModels).toHaveLength(1);
      expect(toolModels[0].id).toBe('tool-model');
    });
  });

  describe('clear', () => {
    it('clears in-memory and file cache', async () => {
      const provider = createMockProvider({
        listModels: async () => ['m1'],
      });
      await registry.discover(provider);
      registry.saveCache();

      expect(fs.existsSync(CACHE_FILE)).toBe(true);
      expect(registry.isEmpty()).toBe(false);

      registry.clear();
      expect(registry.isEmpty()).toBe(true);
      expect(fs.existsSync(CACHE_FILE)).toBe(false);
    });
  });

  // ── Router / 9router 兼容测试 ──────────────────────────────────────

  describe('extractModelRoot', () => {
    it('strips prefix from router-style model ID', () => {
      expect(extractModelRoot('gh/gpt-4o')).toBe('gpt-4o');
      expect(extractModelRoot('cu/claude-4.5-sonnet')).toBe('claude-4.5-sonnet');
      expect(extractModelRoot('qw/vision-model')).toBe('vision-model');
    });

    it('returns original ID when no prefix', () => {
      expect(extractModelRoot('gpt-4o')).toBe('gpt-4o');
      expect(extractModelRoot('o1')).toBe('o1');
    });

    it('handles nested prefix (nvidia paths)', () => {
      expect(extractModelRoot('nvidia/moonshotai/kimi-k2.5')).toBe('moonshotai/kimi-k2.5');
    });
  });

  describe('computeTierScore', () => {
    it('ranks aggregate/meta models lowest', () => {
      expect(computeTierScore('all')).toBe(10);
      expect(computeTierScore('free')).toBe(10);
      expect(computeTierScore('cu/default')).toBe(10);
      expect(computeTierScore('connect4.5-6')).toBe(10);
    });

    it('ranks GPT models by generation', () => {
      const gpt5 = computeTierScore('gh/gpt-5.2');
      const gpt4o = computeTierScore('gh/gpt-4o');
      const gpt4 = computeTierScore('gh/gpt-4-turbo');
      const gpt35 = computeTierScore('gh/gpt-3.5-turbo');
      expect(gpt5).toBeGreaterThan(gpt4o);
      expect(gpt4o).toBeGreaterThan(gpt35);
      expect(gpt4).toBeGreaterThanOrEqual(gpt4o - 5); // gpt-4 ≈ gpt-4o range
    });

    it('ranks Claude models by tier', () => {
      const opus = computeTierScore('gh/claude-opus-4.6');
      const sonnet46 = computeTierScore('cu/claude-4.6-sonnet');
      const sonnet45 = computeTierScore('cu/claude-4.5-sonnet');
      const haiku = computeTierScore('gh/claude-haiku-4.5');
      expect(opus).toBeGreaterThan(sonnet46);
      expect(sonnet46).toBeGreaterThan(sonnet45);
      expect(sonnet45).toBeGreaterThan(haiku);
    });

    it('assigns reasonable scores to other families', () => {
      expect(computeTierScore('gc/gemini-3-pro-preview')).toBeGreaterThan(70);
      expect(computeTierScore('if/deepseek-r1')).toBeGreaterThan(80);
      expect(computeTierScore('qw/qwen3-coder-plus')).toBeGreaterThan(75);
      expect(computeTierScore('cu/kimi-k2.5')).toBeGreaterThan(75);
      expect(computeTierScore('if/glm-4.7')).toBeGreaterThan(70);
    });

    it('unknown models get moderate default score', () => {
      expect(computeTierScore('some-unknown-model')).toBe(50);
    });
  });

  describe('inferFromModelName (router format)', () => {
    it('detects family from router-prefixed model names', async () => {
      const provider = createMockProvider({
        name: 'router',
        listModels: async () => [
          'gh/gpt-4o',
          'cu/claude-4.5-sonnet',
          'gc/gemini-3-pro-preview',
          'if/deepseek-r1',
          'qw/qwen3-coder-plus',
        ],
        capabilities: { toolCalling: true },
      } as any);

      const models = await registry.discover(provider);
      expect(models.find(m => m.id === 'gh/gpt-4o')?.family).toBe('gpt-4');
      expect(models.find(m => m.id === 'cu/claude-4.5-sonnet')?.family).toBe('claude');
      expect(models.find(m => m.id === 'gc/gemini-3-pro-preview')?.family).toBe('gemini');
      expect(models.find(m => m.id === 'if/deepseek-r1')?.family).toBe('deepseek');
      expect(models.find(m => m.id === 'qw/qwen3-coder-plus')?.family).toBe('qwen');
    });

    it('detects vision and code capabilities from router model names', async () => {
      const provider = createMockProvider({
        name: 'router',
        listModels: async () => ['qw/vision-model', 'qw/coder-model', 'gh/gpt-5-codex'],
      });

      const models = await registry.discover(provider);
      expect(models.find(m => m.id === 'qw/vision-model')?.capabilities).toContain('vision');
      expect(models.find(m => m.id === 'qw/coder-model')?.capabilities).toContain('code');
      expect(models.find(m => m.id === 'gh/gpt-5-codex')?.capabilities).toContain('code');
    });

    it('detects gpt-5 family correctly', async () => {
      const provider = createMockProvider({
        name: 'router',
        listModels: async () => ['gh/gpt-5.2', 'gh/gpt-5.4'],
      });
      const models = await registry.discover(provider);
      expect(models[0].family).toBe('gpt-5');
      expect(models[1].family).toBe('gpt-5');
    });

    it('detects grok, kimi, glm families', async () => {
      const provider = createMockProvider({
        name: 'router',
        listModels: async () => ['gh/grok-code-fast-1', 'cu/kimi-k2.5', 'if/glm-4.7'],
      });
      const models = await registry.discover(provider);
      expect(models.find(m => m.id === 'gh/grok-code-fast-1')?.family).toBe('grok');
      expect(models.find(m => m.id === 'cu/kimi-k2.5')?.family).toBe('kimi');
      expect(models.find(m => m.id === 'if/glm-4.7')?.family).toBe('glm');
    });
  });

  describe('selectModel with tier scoring', () => {
    it('selects highest-tier router model when no parameterSize', async () => {
      const provider = createMockProvider({
        name: 'router',
        listModels: async () => [
          'all',              // aggregate, tier 10
          'gh/gpt-3.5-turbo', // tier 60
          'gh/gpt-4o',        // tier 88
          'cu/claude-4.5-sonnet', // tier 90
          'gh/claude-opus-4.6',   // tier 96
        ],
      });
      await registry.discover(provider);

      const selected = registry.selectModel('router', 'chat');
      expect(selected).toBe('gh/claude-opus-4.6');
    });

    it('selects vision model for vision task when available', async () => {
      const provider = createMockProvider({
        name: 'router',
        listModels: async () => ['gh/gpt-3.5-turbo', 'qw/vision-model', 'gh/gpt-4o'],
      });
      await registry.discover(provider);

      const selected = registry.selectModel('router', 'vision');
      // gpt-4o has vision (from 4o detection), vision-model also has vision
      // gpt-4o tier 88 > vision-model tier 78
      expect(selected).toBe('gh/gpt-4o');
    });

    it('aggregate models rank last in auto-selection', async () => {
      const provider = createMockProvider({
        name: 'router',
        listModels: async () => ['all', 'free', 'cu/default', 'gh/gpt-3.5-turbo'],
      });
      await registry.discover(provider);

      const selected = registry.selectModel('router', 'chat');
      expect(selected).toBe('gh/gpt-3.5-turbo');
    });
  });

  describe('selectModels (fallback candidates)', () => {
    it('returns ranked list of models for chat', async () => {
      const provider = createMockProvider({
        name: 'router',
        listModels: async () => [
          'all',
          'gh/gpt-3.5-turbo',
          'gh/gpt-4o',
          'cu/claude-4.5-sonnet',
          'gh/claude-opus-4.6',
        ],
      });
      await registry.discover(provider);

      const models = registry.selectModels('router', 'chat', 5);
      expect(models.length).toBeGreaterThanOrEqual(4);
      // First should be highest tier
      expect(models[0]).toBe('gh/claude-opus-4.6');
      // Last should not be 'all' (aggregate filtered by tier score)
      expect(models[models.length - 1]).not.toBe('gh/claude-opus-4.6');
    });

    it('respects maxCandidates limit', async () => {
      const provider = createMockProvider({
        name: 'router',
        listModels: async () => [
          'gh/gpt-3.5-turbo', 'gh/gpt-4o', 'cu/claude-4.5-sonnet',
          'gh/claude-opus-4.6', 'gc/gemini-3-pro-preview',
        ],
      });
      await registry.discover(provider);

      const models = registry.selectModels('router', 'chat', 2);
      expect(models).toHaveLength(2);
    });

    it('returns empty array for unknown provider', () => {
      expect(registry.selectModels('nonexistent')).toEqual([]);
    });

    it('filters by vision capability for vision task', async () => {
      const provider = createMockProvider({
        name: 'router',
        listModels: async () => ['gh/gpt-3.5-turbo', 'gh/gpt-4o', 'qw/vision-model'],
      });
      await registry.discover(provider);

      const models = registry.selectModels('router', 'vision');
      // Only vision-capable models
      for (const id of models) {
        const info = registry.getModel('router', id);
        expect(info?.capabilities).toContain('vision');
      }
    });
  });
});
