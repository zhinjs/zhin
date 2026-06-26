export const EMPTY = 0;
export const X = 1;
export const O = 2;

export type Cell = typeof EMPTY | typeof X | typeof O;
export type Board = Cell[];

export type GameStatus = 'active' | 'won' | 'draw' | 'aborted';

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function emptyBoard(): Board {
  return Array(9).fill(EMPTY);
}

export function parseBoard(raw: string | number[] | null | undefined): Board {
  if (Array.isArray(raw)) return raw.map((v) => Number(v) as Cell);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as number[];
      if (Array.isArray(parsed) && parsed.length === 9) {
        return parsed.map((v) => Number(v) as Cell);
      }
    } catch {
      // fall through
    }
  }
  return emptyBoard();
}

export function cellLabel(cell: Cell): string {
  if (cell === X) return '✕';
  if (cell === O) return '○';
  return '·';
}

export function asciiBoard(board: Board, highlight?: number[]): string {
  const mark = (i: number) => {
    const base = cellLabel(board[i]!);
    return highlight?.includes(i) ? `[${base}]` : ` ${base} `;
  };
  return [
    `${mark(0)}|${mark(1)}|${mark(2)}`,
    '-+-+-',
    `${mark(3)}|${mark(4)}|${mark(5)}`,
    '-+-+-',
    `${mark(6)}|${mark(7)}|${mark(8)}`,
  ].join('\n');
}

export function checkWinner(board: Board): { winner: Cell; line: number[] } | null {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const v = board[a!]!;
    if (v !== EMPTY && v === board[b!] && v === board[c!]) {
      return { winner: v, line };
    }
  }
  return null;
}

export function isDraw(board: Board): boolean {
  return board.every((c) => c !== EMPTY) && !checkWinner(board);
}

export function validMove(board: Board, cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < 9 && board[cell] === EMPTY;
}

export function applyMove(board: Board, cell: number, player: Cell): Board {
  if (!validMove(board, cell)) throw new Error('invalid move');
  const next = [...board] as Board;
  next[cell] = player;
  return next;
}

export function opponent(player: Cell): Cell {
  return player === X ? O : X;
}

/** Minimax for tic-tac-toe (O = AI by default when aiPlays O) */
export function bestMove(board: Board, ai: Cell = O): number {
  const human = opponent(ai);
  let bestScore = -Infinity;
  let move = -1;

  for (let i = 0; i < 9; i++) {
    if (board[i] !== EMPTY) continue;
    const next = applyMove(board, i, ai);
    const score = minimax(next, 0, false, ai, human);
    if (score > bestScore) {
      bestScore = score;
      move = i;
    }
  }
  return move;
}

function minimax(
  board: Board,
  depth: number,
  isAi: boolean,
  ai: Cell,
  human: Cell,
): number {
  const win = checkWinner(board);
  if (win?.winner === ai) return 10 - depth;
  if (win?.winner === human) return depth - 10;
  if (isDraw(board)) return 0;

  const player = isAi ? ai : human;
  let best = isAi ? -Infinity : Infinity;

  for (let i = 0; i < 9; i++) {
    if (board[i] !== EMPTY) continue;
    const next = applyMove(board, i, player);
    const score = minimax(next, depth + 1, !isAi, ai, human);
    best = isAi ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

export function playerMark(playerId: string, session: { playerX: string; playerO: string }): Cell | null {
  if (playerId === session.playerX) return X;
  if (playerId === session.playerO) return O;
  return null;
}
