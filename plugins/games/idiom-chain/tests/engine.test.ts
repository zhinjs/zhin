import { describe, it, expect } from 'vitest';
import {
  validatePlayerIdiom,
  pickBotIdiom,
  idiomCount,
  lastSyllableNoTone,
} from '../src/engine.js';

describe('idiom chain engine', () => {
  it('has substantial idiom pool from npm package', () => {
    expect(idiomCount()).toBeGreaterThan(10000);
  });

  it('validates same-char mode', () => {
    const used = new Set<string>(['一心一意']);
    const ok = validatePlayerIdiom('意气风发', '一心一意', 'char', used);
    expect(ok.ok).toBe(true);
    const wrong = validatePlayerIdiom('一马当先', '一心一意', 'char', used);
    expect(wrong.ok).toBe(false);
  });

  it('validates pinyin (homophone) mode', () => {
    const used = new Set<string>(['一心一意']);
    const tailPy = lastSyllableNoTone('一心一意');
    expect(tailPy).toBeTruthy();

    const bot = pickBotIdiom('一心一意', 'pinyin', used);
    expect(bot?.text).toHaveLength(4);
    const ok = validatePlayerIdiom(bot!.text, '一心一意', 'pinyin', used);
    expect(ok.ok).toBe(true);
  });

  it('bot picks follow-up in char mode', () => {
    const used = new Set<string>(['一心一意']);
    const bot = pickBotIdiom('一心一意', 'char', used);
    expect(bot?.text[0]).toBe('意');
    expect(bot?.text).toHaveLength(4);
  });
});
