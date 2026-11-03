import { extractModelRoot, computeTierScore } from '../src/model-name-utils.js';

describe('pure model-name utilities (not capability evidence)', () => {
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

});
