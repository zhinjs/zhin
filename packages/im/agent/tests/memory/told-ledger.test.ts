import { describe, expect, it } from 'vitest';
import { SessionToldLedger, TOLD_LEDGER_HEADING, extractToldEntries } from '../../src/memory/told-ledger.js';

describe('extractToldEntries', () => {
  it('keeps the lead sentence as a conclusion and promises as commitments', () => {
    expect(extractToldEntries('周报周五前交。格式见模板。我会在周五上午提醒你。', 'reply')).toEqual([
      { kind: 'conclusion', text: '周报周五前交。' },
      { kind: 'commitment', text: '我会在周五上午提醒你。' },
    ]);
  });

  it('records a progress update as one entry without its marker', () => {
    expect(extractToldEntries('⏳ 已经读完 3 个文件，正在整理结论', 'progress')).toEqual([
      { kind: 'progress', text: '已经读完 3 个文件，正在整理结论' },
    ]);
  });

  it('ignores empty text', () => {
    expect(extractToldEntries('   ', 'reply')).toEqual([]);
  });
});

describe('SessionToldLedger', () => {
  it('deduplicates repeated statements, keeping the newest position', () => {
    const ledger = new SessionToldLedger();
    ledger.record('s1', '答案是 42。', 'reply');
    ledger.record('s1', '天气晴。', 'reply');
    ledger.record('s1', '答案是 42 ！', 'reply');
    expect(ledger.entries('s1').map((entry) => entry.text)).toEqual(['天气晴。', '答案是 42 ！']);
  });

  it('keeps at most maxEntries per session', () => {
    const ledger = new SessionToldLedger({ maxEntries: 2 });
    for (const text of ['一号结论。', '二号结论。', '三号结论。']) ledger.record('s1', text, 'reply');
    expect(ledger.entries('s1').map((entry) => entry.text)).toEqual(['二号结论。', '三号结论。']);
  });

  it('is scoped per session and evicts the least recently used session', () => {
    const ledger = new SessionToldLedger({ maxSessions: 2 });
    ledger.record('a', '甲方案。', 'reply');
    ledger.record('b', '乙方案。', 'reply');
    ledger.record('c', '丙方案。', 'reply');
    expect(ledger.render('a')).toBeUndefined();
    expect(ledger.render('b')).toContain('乙方案。');
    expect(ledger.render('c')).not.toContain('乙方案。');
  });

  it('renders a short block with the heading', () => {
    const ledger = new SessionToldLedger();
    ledger.record('s1', '我会明天提醒你。', 'reply');
    const block = ledger.render('s1')!;
    expect(block.startsWith(TOLD_LEDGER_HEADING)).toBe(true);
    expect(block).toContain('- (commitment) 我会明天提醒你。');
  });
});
