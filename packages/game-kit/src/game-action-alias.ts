const TTT_ACTIONS: Record<string, string> = {
  bot: 'bot',
  join: 'join',
  leave: 'leave',
  quit: 'quit',
  spectate: 'spectate',
  help: 'help',
  人机: 'bot',
  排队: 'join',
  加入: 'join',
  离开: 'leave',
  认输: 'quit',
  观战: 'spectate',
  帮助: 'help',
};

const ADV_ACTIONS: Record<string, string> = {
  start: 'start',
  continue: 'continue',
  map: 'map',
  achievements: 'achievements',
  achievement: 'achievements',
  quit: 'quit',
  help: 'help',
  开始: 'start',
  继续: 'continue',
  地图: 'map',
  成就: 'achievements',
  放弃: 'quit',
  退出: 'quit',
  帮助: 'help',
};

const RPS_ACTIONS: Record<string, string> = {
  start: 'start',
  continue: 'continue',
  quit: 'quit',
  help: 'help',
  开始: 'start',
  继续: 'continue',
  放弃: 'quit',
  帮助: 'help',
};

const GUESS_ACTIONS: Record<string, string> = {
  start: 'start',
  quit: 'quit',
  help: 'help',
  开始: 'start',
  放弃: 'quit',
  帮助: 'help',
};

const DICE_ACTIONS: Record<string, string> = {
  start: 'start',
  continue: 'continue',
  quit: 'quit',
  help: 'help',
  开始: 'start',
  继续: 'continue',
  放弃: 'quit',
  帮助: 'help',
};

function lookup(map: Record<string, string>, raw: string): string {
  const t = raw.trim();
  if (!t) return 'help';
  return map[t] ?? map[t.toLowerCase()] ?? t.toLowerCase();
}

export function normalizeTttAction(raw: string): string {
  return lookup(TTT_ACTIONS, raw);
}

/** 判断 normalize*Action 的结果是否为已知 action（未知名应放行，避免劫持普通聊天） */
function isKnownAction(map: Record<string, string>, action: string): boolean {
  return Object.values(map).includes(action);
}

export function isTttAction(action: string): boolean {
  return isKnownAction(TTT_ACTIONS, action);
}

export function normalizeAdvAction(raw: string): string {
  return lookup(ADV_ACTIONS, raw);
}

export function isAdvAction(action: string): boolean {
  return isKnownAction(ADV_ACTIONS, action);
}

export function normalizeRpsAction(raw: string): string {
  return lookup(RPS_ACTIONS, raw);
}

export function isRpsAction(action: string): boolean {
  return isKnownAction(RPS_ACTIONS, action);
}

export function normalizeGuessAction(raw: string): string {
  return lookup(GUESS_ACTIONS, raw);
}

export function isGuessAction(action: string): boolean {
  return isKnownAction(GUESS_ACTIONS, action);
}

export function normalizeDiceAction(raw: string): string {
  return lookup(DICE_ACTIONS, raw);
}

export function isDiceAction(action: string): boolean {
  return isKnownAction(DICE_ACTIONS, action);
}

const CHAIN_ACTIONS: Record<string, string> = {
  start: 'start_pinyin',
  start_pinyin: 'start_pinyin',
  start_char: 'start_char',
  continue: 'continue',
  quit: 'quit',
  help: 'help',
  pinyin: 'start_pinyin',
  char: 'start_char',
  开始: 'start_pinyin',
  同音: 'start_pinyin',
  同字: 'start_char',
  继续: 'continue',
  放弃: 'quit',
  帮助: 'help',
};

const RIDDLE_ACTIONS: Record<string, string> = {
  start: 'start',
  continue: 'continue',
  quit: 'quit',
  help: 'help',
  char: 'char',
  idiom: 'idiom',
  开始: 'start',
  继续: 'continue',
  放弃: 'quit',
  帮助: 'help',
  字谜: 'char',
  成语: 'idiom',
};

export function normalizeChainAction(raw: string): string {
  return lookup(CHAIN_ACTIONS, raw);
}

export function isChainAction(action: string): boolean {
  return isKnownAction(CHAIN_ACTIONS, action);
}

export function isRiddleAction(action: string): boolean {
  return isKnownAction(RIDDLE_ACTIONS, action);
}

export function normalizeRiddleAction(raw: string): string {
  return lookup(RIDDLE_ACTIONS, raw);
}
