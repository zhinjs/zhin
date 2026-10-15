import { ModelRegistry } from '@zhin.js/ai';
import { resolveModelCandidates } from '../../src/context/model-resolver.js';

describe('resolveModelCandidates', () => {
  it('显式 models 白名单应过滤 ModelRegistry 缓存中的域外模型', () => {
    const registry = new ModelRegistry();
    registry.seedProviderModels('aihub', [
      'mistralai/mistral-large-3-675b-instruct-2512',
      'agnes-2.0-flash',
    ]);

    const allowlist = ['agnes-2.0-flash', 'mimo-v2.5-pro'];
    const candidates = resolveModelCandidates(
      allowlist,
      registry,
      'aihub',
      {},
      'chat',
    );

    expect(candidates.every((id) => allowlist.includes(id))).toBe(true);
    expect(candidates).not.toContain('mistralai/mistral-large-3-675b-instruct-2512');
    expect(candidates[0]).toBe('agnes-2.0-flash');
  });

  it('vision 任务仍把绑定的 chatModel 放在第一位，registry 的视觉模型只作后备', () => {
    const registry = new ModelRegistry();
    registry.seedProviderModels('groq', ['openai/gpt-oss-120b', 'llama-4-scout-vision']);

    const candidates = resolveModelCandidates(
      ['openai/gpt-oss-120b', 'llama-4-scout-vision'],
      registry,
      'groq',
      { chatModel: 'openai/gpt-oss-120b' },
      'vision',
    );

    expect(candidates[0]).toBe('openai/gpt-oss-120b');
    expect(candidates).toContain('llama-4-scout-vision');
  });

  it('vision 任务：preferred 仍优先于 chatModel', () => {
    const candidates = resolveModelCandidates(['a', 'b'], null, 'p', { chatModel: 'a' }, 'vision', 'b');
    expect(candidates.slice(0, 2)).toEqual(['b', 'a']);
  });
});
