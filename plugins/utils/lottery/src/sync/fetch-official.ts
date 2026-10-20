import type { DrawNumbers, GameId, NormalizedDraw } from '../types.js';
import { parseNumberList } from '../stats/engine.js';

const FUCAI_URL = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice';
const TICAI_URL = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';
const PAGE_SIZE = 30;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FUCAI_REFERER: Record<string, string> = {
  kl8: 'https://www.cwl.gov.cn/ygkj/wqkjgg/kl8/',
  ssq: 'https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/',
  '3d': 'https://www.cwl.gov.cn/ygkj/wqkjgg/3d/',
};

function fucaiHeaders(fucaiName: string): Record<string, string> {
  return {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: FUCAI_REFERER[fucaiName] ?? 'https://www.cwl.gov.cn/',
  };
}

function ticaiHeaders(): Record<string, string> {
  return {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: 'https://www.lottery.gov.cn/',
    Origin: 'https://www.lottery.gov.cn',
  };
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchFucaiDraws(
  fucaiName: string,
  count: number,
  fetchImpl: typeof fetch = fetch,
): Promise<NormalizedDraw[]> {
  const headers = fucaiHeaders(fucaiName);
  const draws: NormalizedDraw[] = [];
  let pageNo = 1;
  while (draws.length < count) {
    const pageSize = Math.min(PAGE_SIZE, count - draws.length);
    const params = new URLSearchParams({
      name: fucaiName,
      pageNo: String(pageNo),
      pageSize: String(pageSize),
      systemType: 'PC',
      issueCount: '',
      issueStart: '',
      issueEnd: '',
      dayStart: '',
      dayEnd: '',
    });
    const json = await fetchJson<{ state?: number; message?: string; result?: unknown[] }>(
      `${FUCAI_URL}?${params}`,
      headers,
      fetchImpl,
    );
    if (json.state !== 0) {
      throw new Error(json.message ?? `福彩接口 state=${String(json.state)}`);
    }
    const batch = (json.result ?? []).map((row) => parseFucaiRow(fucaiName, row));
    if (!batch.length) break;
    draws.push(...batch);
    if (batch.length < pageSize) break;
    pageNo++;
  }
  return draws.slice(0, count);
}

export async function fetchTicaiDraws(
  gameNo: string,
  count: number,
  fetchImpl: typeof fetch = fetch,
): Promise<NormalizedDraw[]> {
  const headers = ticaiHeaders();
  const draws: NormalizedDraw[] = [];
  let pageNo = 1;
  while (draws.length < count) {
    const pageSize = Math.min(PAGE_SIZE, count - draws.length);
    const params = new URLSearchParams({
      gameNo,
      provinceId: '0',
      pageSize: String(pageSize),
      pageNo: String(pageNo),
      isVerify: '1',
    });
    const json = await fetchJson<{
      success?: boolean;
      errorMessage?: string;
      value?: { list?: unknown[] };
    }>(`${TICAI_URL}?${params}`, headers, fetchImpl);
    if (json.success === false) {
      throw new Error(json.errorMessage ?? '体彩接口返回失败');
    }
    const batch = (json.value?.list ?? []).map((row) => parseTicaiRow(gameNo, row));
    if (!batch.length) break;
    draws.push(...batch);
    if (batch.length < pageSize) break;
    pageNo++;
  }
  return draws.slice(0, count);
}

function parseFucaiRow(fucaiName: string, row: unknown): NormalizedDraw {
  const r = row as Record<string, string>;
  const issue = String(r.code ?? r.issue ?? '');
  const drawTime = String(r.date ?? r.opentime ?? '').replace(/\([^)]*\)$/, '');
  const gameId = fucaiNameToGameId(fucaiName);
  const numbers = parseFucaiNumbers(gameId, r);
  return { gameId, issue, drawTime, numbers, source: 'fucai' };
}

function fucaiNameToGameId(name: string): GameId {
  if (name === 'kl8') return 'kl8';
  if (name === 'ssq') return 'ssq';
  return 'fc3d';
}

function parseFucaiNumbers(gameId: GameId, r: Record<string, string>): DrawNumbers {
  if (gameId === 'kl8') {
    const raw = r.red ?? r.kjhyjsx ?? r.kjSpare ?? r.number ?? '';
    return { main: parseNumberList(raw) };
  }
  if (gameId === 'ssq') {
    return {
      red: parseNumberList(r.red),
      blue: parseNumberList(r.blue),
    };
  }
  const digits = parseNumberList(r.red ?? r.code ?? '');
  if (digits.length >= 3) return { digits: digits.slice(0, 3) };
  const s = String(r.red ?? r.code ?? '').replace(/\D/g, '');
  return { digits: [...s].slice(0, 3).map((c) => Number.parseInt(c, 10)) };
}

function parseTicaiRow(gameNo: string, row: unknown): NormalizedDraw {
  const r = row as Record<string, string>;
  const issue = String(r.lotteryDrawNum ?? r.issue ?? '');
  const drawTime = String(r.lotteryDrawTime ?? r.drawTime ?? '').split(' ')[0] ?? '';
  const gameId = ticaiGameNoToGameId(gameNo);
  const numbers = parseTicaiNumbers(gameId, r);
  return { gameId, issue, drawTime, numbers, source: 'ticai' };
}

function ticaiGameNoToGameId(gameNo: string): GameId {
  if (gameNo === '85') return 'dlt';
  if (gameNo === '35') return 'pl3';
  return 'pl5';
}

function parseTicaiNumbers(gameId: GameId, r: Record<string, string>): DrawNumbers {
  const result = String(r.lotteryDrawResult ?? r.number ?? '');
  if (gameId === 'dlt') {
    if (result.includes('+')) {
      const [frontRaw, backRaw] = result.split('+').map((s) => s.trim());
      return {
        front: parseNumberList(frontRaw),
        back: parseNumberList(backRaw),
      };
    }
    const nums = parseNumberList(result);
    return { front: nums.slice(0, 5), back: nums.slice(5, 7) };
  }
  const digits = result
    .replace(/\D/g, '')
    .split('')
    .map((c) => Number.parseInt(c, 10))
    .filter((n) => Number.isFinite(n));
  const len = gameId === 'pl5' ? 5 : 3;
  return { digits: digits.slice(0, len) };
}
