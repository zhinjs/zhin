import { describe, expect, it } from 'vitest';
import { isCancelWord, isConfirmWord } from '../src/index.js';
import { parseUserInteractionAnswer } from '../src/built/user-interaction.js';
import { isInteractionCancelFirst, isInteractionCancelReply } from '../src/built/interaction-cancel.js';

// #1250 第 74 批：确认 / 取消词的唯一词表，中英文合并、不分语言。
describe('isConfirmWord / isCancelWord', () => {
  it.each(['确认', '确定', '同意', 'confirm', 'yes', 'y', 'ok', 'agree'])('takes %s as a confirm word everywhere', word => {
    expect(isConfirmWord(word)).toBe(true);
    expect(isConfirmWord(word, { yesNo: true })).toBe(true);
    expect(isCancelWord(word, { yesNo: true })).toBe(false);
  });

  it.each(['取消', '退出', '算了', 'cancel', 'quit', 'exit'])('takes %s as a cancel word everywhere', word => {
    expect(isCancelWord(word)).toBe(true);
    expect(isCancelWord(word, { yesNo: true })).toBe(true);
    expect(isConfirmWord(word, { yesNo: true })).toBe(false);
  });

  it('takes 是 / 好 / 不 / 否 / no / n / 拒绝 only in a yes/no question', () => {
    for (const word of ['是', '好', 'true']) {
      expect(isConfirmWord(word)).toBe(false);
      expect(isConfirmWord(word, { yesNo: true })).toBe(true);
    }
    for (const word of ['不', '否', '拒绝', 'no', 'n', 'reject', 'false']) {
      expect(isCancelWord(word)).toBe(false);
      expect(isCancelWord(word, { yesNo: true })).toBe(true);
    }
  });

  it('normalizes full-width forms, case, surrounding blanks and trailing punctuation', () => {
    for (const text of ['YES', 'Ｙｅｓ', ' ok ', 'OK!', '确认！', '确定。', 'confirm.', '同意～', 'Ｏｋ？']) {
      expect(isConfirmWord(text)).toBe(true);
    }
    for (const text of ['CANCEL', 'Ｃａｎｃｅｌ', '取消！', '退出。', '算了…', 'Quit!!', ' exit. ']) {
      expect(isCancelWord(text)).toBe(true);
    }
  });

  it('matches whole replies only, never words inside a sentence', () => {
    for (const text of ['我不确定', '确认一下时间', 'ok then what', '是吗', '好的吧', '']) {
      expect(isConfirmWord(text, { yesNo: true })).toBe(false);
    }
    for (const text of ['我不确定', '取消了吗', '算了吧', '退出群聊', 'cancel the order', 'not', '不要', '!取消', '']) {
      expect(isCancelWord(text, { yesNo: true })).toBe(false);
    }
  });

  it('keeps option numbers out of the shared vocabulary', () => {
    expect(isConfirmWord('1', { yesNo: true })).toBe(false);
    expect(isCancelWord('2', { yesNo: true })).toBe(false);
  });
});

describe('confirm prompt answers are not tied to the prompt language', () => {
  const confirm = { type: 'confirm' as const, title: '继续？' };

  it.each(['zh-CN', 'en'] as const)('a %s confirm prompt accepts Chinese and English answers alike', locale => {
    for (const answer of ['确认', '确定', '是', '好', '同意', 'yes', 'Y', 'ok', 'confirm', 'true', '1', 'Yes!', '确认。']) {
      expect(parseUserInteractionAnswer(confirm, answer, locale)).toEqual({ ok: true, value: true });
    }
    for (const answer of ['取消', '退出', '算了', '不', '否', '拒绝', 'no', 'N', 'cancel', 'quit', 'exit', 'false', '2', 'No.', '取消！']) {
      expect(parseUserInteractionAnswer(confirm, answer, locale)).toEqual({ ok: true, value: false });
    }
    for (const answer of ['我不确定', '也许', 'maybe', '好的吧']) {
      expect(parseUserInteractionAnswer(confirm, answer, locale)).toMatchObject({ ok: false });
    }
  });

  it('still accepts custom labels, normalized the same way', () => {
    const request = { ...confirm, confirmLabel: '开始', cancelLabel: 'Later' };
    expect(parseUserInteractionAnswer(request, '开始！', 'en')).toEqual({ ok: true, value: true });
    expect(parseUserInteractionAnswer(request, 'LATER.', 'zh-CN')).toEqual({ ok: true, value: false });
  });

  it('reads boolean list items with the same vocabulary in every language', () => {
    const list = { type: 'list' as const, title: '开关', valueType: 'boolean' as const };
    expect(parseUserInteractionAnswer(list, 'yes, 否, 是, no, 1, 2', 'en'))
      .toEqual({ ok: true, value: [true, false, true, false, true, false] });
    expect(parseUserInteractionAnswer(list, 'yes, 也许', 'zh-CN')).toMatchObject({ ok: false });
  });
});

describe('select options aliased with a confirm or no word', () => {
  const approval = {
    type: 'select' as const,
    title: '操作确认',
    options: [
      { label: 'Reject', value: 'reject', aliases: ['否', 'no'] },
      { label: 'Allow once', value: 'approve-once', aliases: ['确认', 'yes'] },
      { label: 'Always allow', value: 'approve-always', aliases: ['始终允许'] },
    ],
  };

  it('accepts every confirm word and every no-answer for the matching option', () => {
    for (const answer of ['确认', '确定', '同意', 'ok', 'Y', 'confirm', '是', '好', 'YES!']) {
      expect(parseUserInteractionAnswer(approval, answer, 'en')).toEqual({ ok: true, value: 'approve-once' });
    }
    for (const answer of ['否', '不', '拒绝', 'no', 'n', 'reject', 'No.']) {
      expect(parseUserInteractionAnswer(approval, answer, 'zh-CN')).toEqual({ ok: true, value: 'reject' });
    }
  });

  it('leaves cancel words to cancel the prompt and keeps exact labels first', () => {
    expect(parseUserInteractionAnswer(approval, '取消', 'zh-CN')).toMatchObject({ ok: false });
    expect(isInteractionCancelReply(approval, '取消')).toBe(true);
    expect(isInteractionCancelReply(approval, 'Cancel!')).toBe(true);
    expect(parseUserInteractionAnswer(approval, '始终允许', 'zh-CN')).toEqual({ ok: true, value: 'approve-always' });
    expect(parseUserInteractionAnswer(approval, '3', 'zh-CN')).toEqual({ ok: true, value: 'approve-always' });
  });

  it('does not guess when several options carry a confirm word, or none does', () => {
    const ambiguous = {
      type: 'select' as const,
      title: '选择',
      options: [{ label: '是', value: 'a' }, { label: 'yes', value: 'b' }],
    };
    expect(parseUserInteractionAnswer(ambiguous, 'ok', 'zh-CN')).toMatchObject({ ok: false });
    const plain = { type: 'select' as const, title: '环境', options: [{ label: '开发', value: 'dev' }, { label: '生产', value: 'prod' }] };
    expect(parseUserInteractionAnswer(plain, 'yes', 'en')).toMatchObject({ ok: false });
    expect(parseUserInteractionAnswer(plain, '生产。', 'zh-CN')).toEqual({ ok: true, value: 'prod' });
  });
});

describe('leaving a prompt with a cancel word', () => {
  it.each(['取消', '退出', '算了', 'cancel', 'QUIT', 'exit!', '取消。'])('leaves a number prompt on %s', word => {
    expect(isInteractionCancelReply({ type: 'number', title: '年龄' }, word)).toBe(true);
  });

  it('keeps yes/no answers and sentences as data of the prompt', () => {
    for (const text of ['no', '不', '我不确定', '取消了吗']) {
      expect(isInteractionCancelReply({ type: 'number', title: '年龄' }, text)).toBe(false);
    }
    expect(isInteractionCancelFirst({ type: 'list', title: '标签' }, '算了')).toBe(true);
    expect(isInteractionCancelFirst({ type: 'list', title: '标签' }, 'no')).toBe(false);
  });
});
