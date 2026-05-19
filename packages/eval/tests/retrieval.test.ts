import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateRanking, evaluateRetrieval, ndcgAt, recallAt } from '../src/index.ts';

describe('retrieval metrics', () => {
  it('computes nDCG with graded relevance', () => {
    const qrels = { a: 3, b: 2, c: 1 };
    assert.equal(ndcgAt(['a', 'b', 'c'], qrels, 3), 1);
    assert.ok(ndcgAt(['c', 'b', 'a'], qrels, 3) < 1);
  });

  it('computes recall over binary relevant ids', () => {
    const qrels = { a: 3, b: 1, c: 0 };
    assert.equal(recallAt(['a'], qrels, 1), 0.5);
    assert.equal(recallAt(['a', 'b'], qrels, 2), 1);
  });

  it('evaluates an async retriever and aggregates means', async () => {
    const result = await evaluateRetrieval(
      [
        { id: 'q1', query: 'alpha', relevant: { a: 3 } },
        { id: 'q2', query: 'beta', relevant: { b: 3 } },
      ],
      async (testCase) => [{ id: testCase.id === 'q1' ? 'a' : 'x' }],
    );

    assert.equal(result.summary.queries, 2);
    assert.equal(result.summary.mrrAt10, 0.5);
    assert.equal(result.perQuery[0]!.ndcgAt10, 1);
    assert.equal(result.perQuery[1]!.recallAt5, 0);
  });

  it('keeps retrieved ids for failure diagnostics', () => {
    const result = evaluateRanking('q1', ['wrong', 'right'], { right: 3 });
    assert.deepEqual(result.retrieved, ['wrong', 'right']);
  });
});
