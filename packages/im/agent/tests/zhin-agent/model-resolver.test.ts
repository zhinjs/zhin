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
});
