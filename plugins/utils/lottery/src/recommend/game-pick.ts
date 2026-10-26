import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import { type DrawNumbers, type GameId, type GamePick, type NormalizedDraw, type ScoreWeights, type StatsSnapshot, type AccuracySnapshot } from '../types.js';
import { getGameMeta } from '../games/registry.js';
import { recommendKl8Groups, resolveKl8Config, type Kl8Config } from '../games/kl8-groups.js';
import { pad2, pickTopUnique, scoreDigits, scorePool } from '../stats/engine.js';
import { computeDigitProMetrics, computeProMetrics } from '../stats/pro-analysis.js';

function buildSnapshot(
  gameId: GameId,
  draws: NormalizedDraw[],
  hot: number[],
  cold: number[],
  detail: string,
  pro: StatsSnapshot['pro'],
  accuracy?: AccuracySnapshot,
  _weights?: ScoreWeights,
): StatsSnapshot {
  return {
    gameId,
    sampleSize: draws.length,
    hot: hot.map(String),
    cold: cold.map(String),
    detail,
    pro,
    accuracy,
  };
}

function poolDraws(draws: NormalizedDraw[], extract: (n: DrawNumbers) => number[]): number[][] {
  return draws.map((d) => extract(d.numbers)).filter((a) => a.length > 0);
}

export interface RecommendOptions {
  locale?: Locale;
  pickCount: number;
  tieSeed: string;
  weights?: ScoreWeights;
  accuracy?: AccuracySnapshot;
  kl8?: Kl8Config;
}

export function recommendGame(
  gameId: GameId,
  draws: NormalizedDraw[],
  options: RecommendOptions,
): GamePick {
  const locale = resolveLocale(options.locale);
  const meta = getGameMeta(gameId);
  const name = locale === 'en' ? t(locale, `game.${gameId}`) : meta.name;
  const tieSeed = `${options.tieSeed}:${gameId}`;
  const weights = options.weights ?? { freq: 0.4, omit: 0.35, trend: 0.25 };

  switch (gameId) {
    case 'kl8': {
      const kl8 = options.kl8 ?? resolveKl8Config(options.pickCount);
      const rows = poolDraws(draws, (n) => n.main ?? []);
      if (kl8.recommendGroups <= 1) {
        const scores = scorePool(rows, 1, 80, tieSeed, weights);
        const pick = pickTopUnique(scores, kl8.pickCount);
        const hot = scores.slice(0, 5).map((s) => s.value);
        const cold = [...scores].reverse().slice(0, 5).map((s) => s.value);
        const pro = computeProMetrics(gameId, pick, draws, weights, 1, 80, 40, locale);
        return {
          gameId,
          locale,
          label: t(locale, 'pickLabel', { name, count: pick.length }),
          numbers: { main: pick },
          weights,
          stats: buildSnapshot(
            gameId,
            draws,
            hot,
            cold,
            t(locale, 'basicDetail', { sum: pro.sum, span: pro.span }),
            pro,
            options.accuracy,
            weights,
          ),
        };
      }
      const multi = recommendKl8Groups(draws, {
        pickCount: kl8.pickCount,
        recommendGroups: kl8.recommendGroups,
        strategies: kl8.groupStrategies,
        tieSeed,
        baseWeights: weights,
        locale,
      });
      const primary = multi.groups[0]?.numbers ?? [];
      const hot = multi.scores.slice(0, 5).map((s) => s.value);
      const cold = [...multi.scores].reverse().slice(0, 5).map((s) => s.value);
      const pro = computeProMetrics(gameId, primary, draws, weights, 1, 80, 40, locale);
      const strategyNote = multi.groups.map((g) => g.label).join('/');
      return {
        gameId,
          locale,
        label: t(locale, 'pickGroupsLabel', { name, count: kl8.pickCount, groups: multi.groups.length }),
        numbers: { main: primary },
        weights,
        kl8Groups: multi.groups,
        stats: buildSnapshot(
          gameId,
          draws,
          hot,
          cold,
          t(locale, 'multiDetail', { strategies: strategyNote, sum: pro.sum, span: pro.span }),
          pro,
          options.accuracy,
          weights,
        ),
      };
    }
    case 'ssq': {
      const redRows = poolDraws(draws, (n) => n.red ?? []);
      const blueRows = poolDraws(draws, (n) => n.blue ?? []);
      const redScores = scorePool(redRows, 1, 33, `${tieSeed}:red`, weights);
      const blueScores = scorePool(blueRows, 1, 16, `${tieSeed}:blue`, weights);
      const red = pickTopUnique(redScores, 6);
      const blue = pickTopUnique(blueScores, 1);
      const pro = computeProMetrics(gameId, red, draws, weights, 1, 33, 17, locale);
      return {
        gameId,
          locale,
        label: name,
        numbers: { red, blue },
        weights,
        stats: buildSnapshot(
          gameId,
          draws,
          redScores.slice(0, 5).map((s) => s.value),
          redScores.slice(-5).map((s) => s.value),
          t(locale, 'redDetail', { oddEven: pro.oddEven, bigSmall: pro.bigSmall, blue: blue.map(pad2).join(' ') }),
          pro,
          options.accuracy,
          weights,
        ),
      };
    }
    case 'dlt': {
      const frontRows = poolDraws(draws, (n) => n.front ?? []);
      const backRows = poolDraws(draws, (n) => n.back ?? []);
      const frontScores = scorePool(frontRows, 1, 35, `${tieSeed}:front`, weights);
      const backScores = scorePool(backRows, 1, 12, `${tieSeed}:back`, weights);
      const front = pickTopUnique(frontScores, 5);
      const back = pickTopUnique(backScores, 2);
      const pro = computeProMetrics(gameId, front, draws, weights, 1, 35, 18, locale);
      return {
        gameId,
          locale,
        label: name,
        numbers: { front, back },
        weights,
        stats: buildSnapshot(
          gameId,
          draws,
          frontScores.slice(0, 5).map((s) => s.value),
          frontScores.slice(-5).map((s) => s.value),
          t(locale, 'frontDetail', { oddEven: pro.oddEven, zones: pro.zones ?? '' }).trim(),
          pro,
          options.accuracy,
          weights,
        ),
      };
    }
    case 'fc3d':
    case 'pl3': {
      const rows = poolDraws(draws, (n) => n.digits ?? []);
      const digits = scoreDigits(rows, 3, tieSeed, weights);
      const pro = computeDigitProMetrics(digits, draws, weights, locale);
      return {
        gameId,
          locale,
        label: name,
        numbers: { digits },
        weights,
        stats: buildSnapshot(
          gameId,
          draws,
          digits,
          [],
          t(locale, 'digitDetail', { positions: pro.digitPos ?? '', sum: pro.sum }),
          pro,
          options.accuracy,
          weights,
        ),
      };
    }
    case 'pl5': {
      const rows = poolDraws(draws, (n) => n.digits ?? []);
      const digits = scoreDigits(rows, 5, tieSeed, weights);
      const pro = computeDigitProMetrics(digits, draws, weights, locale);
      return {
        gameId,
          locale,
        label: name,
        numbers: { digits },
        weights,
        stats: buildSnapshot(
          gameId,
          draws,
          digits,
          [],
          t(locale, 'digitDetail', { positions: pro.digitPos ?? '', sum: pro.sum }),
          pro,
          options.accuracy,
          weights,
        ),
      };
    }
    default:
      throw new Error(`Unsupported game ${gameId}`);
  }
}

export function formatPickLine(pick: GamePick, locale: Locale = resolveLocale(pick.locale)): string {
  const n = pick.numbers;
  switch (pick.gameId) {
    case 'kl8': {
      if (pick.kl8Groups?.length) {
        const header = `■ ${pick.label}`;
        const rows = pick.kl8Groups.map(
          (g) => t(locale, 'groupLine', { index: g.index, label: g.label, numbers: g.numbers.map(pad2).join(' ') }),
        );
        return [header, ...rows].join('\n');
      }
      return t(locale, 'pickLine', { label: pick.label, numbers: (n.main ?? []).map(pad2).join(' ') });
    }
    case 'ssq':
      return t(locale, 'redLine', { label: pick.label, red: (n.red ?? []).map(pad2).join(' '), blue: (n.blue ?? []).map(pad2).join(' ') });
    case 'dlt':
      return t(locale, 'frontLine', { label: pick.label, front: (n.front ?? []).map(pad2).join(' '), back: (n.back ?? []).map(pad2).join(' ') });
    case 'fc3d':
    case 'pl3':
    case 'pl5':
      return t(locale, 'pickLine', { label: pick.label, numbers: (n.digits ?? []).join(' ') });
    default:
      return `■ ${pick.label}`;
  }
}

export function formatPickStats(pick: GamePick, locale: Locale = resolveLocale(pick.locale)): string {
  const parts: string[] = [];
  const hot = pick.stats.hot.length ? t(locale, 'hot', { numbers: pick.stats.hot.join(',') }) : '';
  const cold = pick.stats.cold.length ? t(locale, 'cold', { numbers: pick.stats.cold.join(',') }) : '';
  if (hot) parts.push(hot);
  if (cold) parts.push(cold);
  if (pick.stats.pro) {
    const p = pick.stats.pro;
    const morph = [p.oddEven, p.bigSmall, p.zones, p.recentHot, p.modelWeights].filter(Boolean).join(' | ');
    if (morph) parts.push(morph);
    if (p.digitPos) parts.push(p.digitPos);
  }
  if (pick.stats.accuracy) {
    const a = pick.stats.accuracy;
    parts.push(t(locale, 'accuracy', { rate: (a.avgHitRate * 100).toFixed(1), count: a.evalCount, recent: a.recent5 }));
  }
  parts.push(pick.stats.detail);
  return `  ${parts.filter(Boolean).join('\n  ')}`;
}
