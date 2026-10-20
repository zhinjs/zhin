/**
 * ToneDetector — 轻量级情绪/语气检测
 *
 * 通过标点符号、emoji 密度、关键词分析用户语气，
 * 生成一条 hint 注入 system prompt，让 AI 的回复匹配用户情绪。
 *
 * 零 LLM 开销，纯正则/统计分析。
 */

export type Tone = 'neutral' | 'frustrated' | 'excited' | 'questioning' | 'sad' | 'urgent';

interface ToneResult {
  tone: Tone;
  hint: string;
}

// 常见负面情绪词
const FRUSTRATED_WORDS = /不行|不对|又错|还是不|怎么回事|搞不定|烦死|崩溃|无语|什么鬼|bug|报错|失败|出问题/;
const SAD_WORDS = /难过|伤心|失落|遗憾|可惜|唉|哎|不开心|郁闷|心累/;
const URGENT_WORDS = /急|赶紧|马上|立刻|紧急|尽快|快点|asap|hurry/i;
const EXCITED_WORDS = /太好了|太棒了|厉害|牛|可以|成功|搞定|完美|赞|nice|amazing|awesome|cool/i;

/**
 * 检测用户消息的情绪语气
 */
export function detectTone(message: string): ToneResult {
  const len = message.length;
  if (len === 0) return { tone: 'neutral', hint: '' };

  // 统计特征
  const exclamations = (message.match(/!/g) || []).length + (message.match(/！/g) || []).length;
  const questions = (message.match(/\?/g) || []).length + (message.match(/？/g) || []).length;
  const ellipsis = (message.match(/\.\.\./g) || []).length + (message.match(/…/g) || []).length;
  const capsRatio = len > 5 ? (message.match(/[A-Z]/g) || []).length / len : 0;

  // emoji 检测（常见 Unicode 范围）
  const emojiCount = (message.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).length;

  // 关键词检测
  const isFrustrated = FRUSTRATED_WORDS.test(message);
  const isSad = SAD_WORDS.test(message);
  const isUrgent = URGENT_WORDS.test(message);
  const isExcited = EXCITED_WORDS.test(message);

  // 判定优先级: frustrated > urgent > sad > excited > questioning > neutral
  if (isFrustrated || (exclamations >= 3 && !isExcited)) {
    return {
      tone: 'frustrated',
      hint: '用户似乎有些沮丧或受挫，请用耐心、理解的语气回复，先表示共情再提供帮助。',
    };
  }

  if (isUrgent) {
    return {
      tone: 'urgent',
      hint: '用户似乎很着急，请直接给出解决方案，减少寒暄，优先效率。',
    };
  }

  if (isSad || ellipsis >= 2) {
    return {
      tone: 'sad',
      hint: '用户的语气似乎有些低落，请用温暖、关心的语气回复。',
    };
  }

  if (isExcited || (emojiCount >= 2 && exclamations >= 1)) {
    return {
      tone: 'excited',
      hint: '用户的心情不错，可以用更活泼、热情的语气回复。',
    };
  }

  if (questions >= 2 || (questions >= 1 && len < 20)) {
    return {
      tone: 'questioning',
      hint: '', // 提问是正常的，不需要特殊 hint
    };
  }

  if (capsRatio > 0.5 && len > 10) {
    return {
      tone: 'frustrated',
      hint: '用户使用了大量大写字母，可能在表达强烈情绪，请注意语气。',
    };
  }

  return { tone: 'neutral', hint: '' };
}
