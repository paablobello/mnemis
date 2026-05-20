# Mnemis self-corpus benchmark dataset

This dataset uses the Mnemis repository itself as the indexed corpus and asks
questions whose answers map to known files. It is intentionally small (10
queries) so it can be curated by hand and re-checked when the code moves.

Qrels are graded 1-3:

- **3** — the canonical file that should appear in the top results
- **2** — supporting file with relevant context
- **1** — peripheral mention (tests, docs, examples)

A hit is considered relevant when its `path` (or any prefix of it) appears as
a key in `relevant`. The grade contributes to nDCG/MRR/recall via
`@mnemis/eval`.

Add new queries by extending `queries.json`. Run the benchmark with:

```bash
bun run benchmark
```

The first run downloads the local reranker model on demand (~140MB) if
`MNEMIS_RERANK_PROVIDER=local` is set. Subsequent runs are cached.
