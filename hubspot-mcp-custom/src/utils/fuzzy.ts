/**
 * Fuzzy string matching utilities for resolving human-friendly names
 * to HubSpot internal IDs (pipelines, stages, owners, etc.)
 */

/** Compute Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () =>
    Array(lb + 1).fill(0)
  );
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[la][lb];
}

export interface FuzzyMatch<T> {
  item: T;
  score: number; // 0–1, higher = better match
  matchType: "exact" | "case-insensitive" | "substring" | "levenshtein";
}

/**
 * Score how well `query` matches `candidate`.
 * Returns a score from 0 to 1, where 1 is an exact match.
 */
export function fuzzyScore(query: string, candidate: string): FuzzyMatch<null> {
  if (query === candidate) {
    return { item: null, score: 1.0, matchType: "exact" };
  }

  const qLower = query.toLowerCase();
  const cLower = candidate.toLowerCase();

  if (qLower === cLower) {
    return { item: null, score: 0.95, matchType: "case-insensitive" };
  }

  if (cLower.includes(qLower)) {
    // Score based on how much of the candidate the query covers
    const coverage = qLower.length / cLower.length;
    return {
      item: null,
      score: 0.6 + coverage * 0.3, // 0.6–0.9 range
      matchType: "substring",
    };
  }

  if (qLower.includes(cLower)) {
    const coverage = cLower.length / qLower.length;
    return {
      item: null,
      score: 0.5 + coverage * 0.3,
      matchType: "substring",
    };
  }

  // Fall back to Levenshtein distance
  const maxLen = Math.max(qLower.length, cLower.length);
  if (maxLen === 0) return { item: null, score: 1.0, matchType: "exact" };

  const dist = levenshtein(qLower, cLower);
  const similarity = 1 - dist / maxLen;

  return {
    item: null,
    score: Math.max(0, similarity * 0.6), // cap at 0.6 for pure Levenshtein
    matchType: "levenshtein",
  };
}

/**
 * Find the best fuzzy match for `query` among `candidates`.
 * Returns matches sorted by score (best first).
 */
export function fuzzyMatch<T>(
  query: string,
  candidates: T[],
  getText: (item: T) => string
): FuzzyMatch<T>[] {
  return candidates
    .map((item) => {
      const result = fuzzyScore(query, getText(item));
      return { ...result, item };
    })
    .filter((m) => m.score > 0.3)
    .sort((a, b) => b.score - a.score);
}
