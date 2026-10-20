export type RouletteCommandAction =
  | 'help'
  | 'open'
  | 'join'
  | 'start'
  | 'fire'
  | 'leave'
  | 'cancel'
  | 'status'
  | 'penalty-on'
  | 'penalty-off'
  | 'penalty-status';

const ACTION_WORDS: Readonly<Record<string, RouletteCommandAction>> = {
  help: 'help',
  帮助: 'help',
  规则: 'help',
  open: 'open',
  开局: 'open',
  创建: 'open',
  join: 'join',
  加入: 'join',
  start: 'start',
  开始: 'start',
  fire: 'fire',
  shoot: 'fire',
  开枪: 'fire',
  扣动扳机: 'fire',
  leave: 'leave',
  退出: 'leave',
  离开: 'leave',
  认输: 'leave',
  cancel: 'cancel',
  取消: 'cancel',
  status: 'status',
  状态: 'status',
  'mute-on': 'penalty-on',
  开启禁言: 'penalty-on',
  'mute-off': 'penalty-off',
  关闭禁言: 'penalty-off',
  mute: 'penalty-status',
  禁言: 'penalty-status',
};

/** Empty input means help; unknown words return null so normal chat is never hijacked. */
export function normalizeRouletteAction(raw: string): RouletteCommandAction | null {
  const word = raw.trim();
  if (!word) return 'help';
  return ACTION_WORDS[word] ?? ACTION_WORDS[word.toLowerCase()] ?? null;
}

export const ROULETTE_HELP = [
  '🔫 俄罗斯轮盘（2 人起，轮流开枪，中弹者输）',
  '轮盘 开局 — 创建一局并上桌',
  '轮盘 加入 — 加入等待中的对局',
  '轮盘 开始 — 房主开局（弹巢随机装 1 发子弹）',
  '开枪 / 轮盘 开枪 — 轮到你时扣动扳机',
  '轮盘 退出 — 等待时离开；对局中离开算认输',
  '轮盘 取消 — 房主或机器人管理员取消本局（不计分）',
  '轮盘 状态 — 查看当前对局',
  '轮盘 禁言 / 开启禁言 / 关闭禁言 — 查看或切换本群的禁言惩罚（默认关闭）',
  '',
  '规则：按加入顺序轮流开枪；轮到的人超时不开枪判负；幸存者各记 1 胜，输家记 1 负。',
  '战绩与排行：「战绩」「排行 轮盘」。',
].join('\n');
