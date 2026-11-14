import { describe, expect, it } from 'vitest';
import { normalizeChainAction } from '@zhin.js/game-kit';
import { CHAIN_QUICK_START, chainStartAction, getChainHelp } from '../src/chain-command.js';

describe('idiom chain Chinese mode words (#1250)', () => {
  const formatCommand = (path: string) => (path === 'chain' ? '/接龙' : undefined);

  it('advertises 同音 / 同字 in Chinese help and English words in English help', () => {
    const zh = getChainHelp({ locale: 'zh-CN', formatCommand });
    expect(zh).toContain('/接龙 同音');
    expect(zh).toContain('/接龙 同字');
    expect(zh).not.toContain('start_pinyin');
    expect(zh).not.toContain('start_char');
    const en = getChainHelp({ locale: 'en', formatCommand: () => '/chain' });
    expect(en).toContain('/chain pinyin');
    expect(en).toContain('/chain char');
  });

  it('every advertised word, and the legacy one, starts the same mode', () => {
    expect(normalizeChainAction(chainStartAction('pinyin', 'zh-CN'))).toBe('start_pinyin');
    expect(normalizeChainAction(chainStartAction('char', 'zh-CN'))).toBe('start_char');
    expect(normalizeChainAction(chainStartAction('pinyin', 'en'))).toBe('start_pinyin');
    expect(normalizeChainAction(chainStartAction('char', 'en'))).toBe('start_char');
    expect(normalizeChainAction('start_pinyin')).toBe('start_pinyin');
    expect(normalizeChainAction('start_char')).toBe('start_char');
  });

  it('the game hub quick start uses the Chinese word, English for English', () => {
    expect(CHAIN_QUICK_START['zh-CN']).toBe('同音');
    expect(CHAIN_QUICK_START.en).toBe('pinyin');
    expect(normalizeChainAction(CHAIN_QUICK_START['zh-CN'])).toBe('start_pinyin');
    expect(normalizeChainAction(CHAIN_QUICK_START.en)).toBe('start_pinyin');
  });
});
