export type Qrels = Record<string, number>;

export interface RankedHit {
  id: string;
}

export interface RetrievalCase {
  id: string;
  query: string;
  relevant: Qrels;
}

export interface QueryEvaluation {
  queryId: string;
  retrieved: string[];
  ndcgAt10: number;
  mrrAt10: number;
  recallAt5: number;
}

export interface EvaluationSummary {
  queries: number;
  ndcgAt10: number;
  mrrAt10: number;
  recallAt5: number;
}

export interface EvaluationResult {
  perQuery: QueryEvaluation[];
  summary: EvaluationSummary;
}

function relevance(qrels: Qrels, id: string): number {
  return qrels[id] ?? 0;
}

function gain(rel: number): number {
  return 2 ** rel - 1;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function dcgAt(rankedIds: readonly string[], qrels: Qrels, k: number): number {
  return rankedIds.slice(0, k).reduce((sum, id, i) => {
    const discount = Math.log2(i + 2);
    return sum + gain(relevance(qrels, id)) / discount;
  }, 0);
}

export function ndcgAt(rankedIds: readonly string[], qrels: Qrels, k: number): number {
  const ideal = Object.values(qrels)
    .sort((a, b) => b - a)
    .slice(0, k);
  const idealDcg = ideal.reduce((sum, rel, i) => sum + gain(rel) / Math.log2(i + 2), 0);
  if (idealDcg === 0) return 0;
  return dcgAt(rankedIds, qrels, k) / idealDcg;
}

export function mrrAt(rankedIds: readonly string[], qrels: Qrels, k: number): number {
  const rank = rankedIds.slice(0, k).findIndex((id) => relevance(qrels, id) > 0);
  return rank === -1 ? 0 : 1 / (rank + 1);
}

export function recallAt(rankedIds: readonly string[], qrels: Qrels, k: number): number {
  const relevantIds = Object.entries(qrels)
    .filter(([, rel]) => rel > 0)
    .map(([id]) => id);
  if (relevantIds.length === 0) return 0;

  const retrieved = new Set(rankedIds.slice(0, k));
  const matched = relevantIds.filter((id) => retrieved.has(id)).length;
  return matched / relevantIds.length;
}

export function evaluateRanking(
  queryId: string,
  rankedIds: readonly string[],
  qrels: Qrels,
): QueryEvaluation {
  return {
    queryId,
    retrieved: [...rankedIds],
    ndcgAt10: ndcgAt(rankedIds, qrels, 10),
    mrrAt10: mrrAt(rankedIds, qrels, 10),
    recallAt5: recallAt(rankedIds, qrels, 5),
  };
}

export async function evaluateRetrieval(
  cases: readonly RetrievalCase[],
  search: (testCase: RetrievalCase) => Promise<readonly RankedHit[]>,
): Promise<EvaluationResult> {
  const perQuery: QueryEvaluation[] = [];

  for (const testCase of cases) {
    const hits = await search(testCase);
    perQuery.push(
      evaluateRanking(
        testCase.id,
        hits.map((hit) => hit.id),
        testCase.relevant,
      ),
    );
  }

  return {
    perQuery,
    summary: {
      queries: perQuery.length,
      ndcgAt10: mean(perQuery.map((q) => q.ndcgAt10)),
      mrrAt10: mean(perQuery.map((q) => q.mrrAt10)),
      recallAt5: mean(perQuery.map((q) => q.recallAt5)),
    },
  };
}
