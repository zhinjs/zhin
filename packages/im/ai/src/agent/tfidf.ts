/**
 * Shared TF-IDF helpers for tool and skill relevance scoring.
 */
import { tokenize } from './tool-filter.js';

export { tokenize };

export function buildDocumentFrequency(corpusTermSets: Iterable<Set<string>>): Map<string, number> {
  const df = new Map<string, number>();
  for (const terms of corpusTermSets) {
    for (const term of terms) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return df;
}

export function createIdfFn(docCount: number, df: Map<string, number>): (term: string) => number {
  return (term: string) => {
    const docFreq = df.get(term);
    if (!docFreq) return 1.0;
    return Math.max(0.1, Math.log(docCount / docFreq));
  };
}

/** Weighted term overlap: sum(baseWeight * idf) for query tokens present in doc. */
export function scoreWeightedTfidfOverlap(
  query: string,
  docWeightedTerms: Map<string, number>,
  idf: (term: string) => number,
): number {
  const queryLower = query.toLowerCase().trim();
  if (!queryLower) return 0;

  let score = 0;
  const queryTokens = tokenize(queryLower);
  const seen = new Set<string>();

  for (const token of queryTokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    const weight = docWeightedTerms.get(token);
    if (weight !== undefined) score += weight * idf(token);
  }

  if (queryLower.length >= 2 && docWeightedTerms.has(queryLower)) {
    score += docWeightedTerms.get(queryLower)! * idf(queryLower);
  }

  return score;
}

export function collectSkillWeightedTerms(skill: {
  name: string;
  description: string;
  keywords?: string[];
  tags?: string[];
}): Map<string, number> {
  const terms = new Map<string, number>();
  const add = (term: string, weight: number) => {
    const t = term.toLowerCase();
    if (t.length < 2) return;
    terms.set(t, Math.max(terms.get(t) ?? 0, weight));
  };

  if (skill.keywords) {
    for (const kw of skill.keywords) add(kw, 1.0);
  }
  if (skill.tags) {
    for (const tag of skill.tags) add(tag, 0.5);
  }
  for (const nt of skill.name.toLowerCase().split(/[._\-]+/)) add(nt, 0.3);
  add(skill.name.toLowerCase(), 0.3);
  for (const w of tokenize(skill.description.toLowerCase())) add(w, 0.15);

  return terms;
}

export function collectTermSet(weighted: Map<string, number>): Set<string> {
  return new Set(weighted.keys());
}
