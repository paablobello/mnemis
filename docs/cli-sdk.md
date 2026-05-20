# CLI and TypeScript SDK

Mnemis exposes the same HTTP API through `@mnemis/sdk` and the `@mnemis/cli`
workspace package. Both expect a running API and a bearer API key.

## CLI

During development, run the CLI through the workspace script:

```bash
bun run cli help
```

Authenticate once and store credentials locally:

```bash
bun run cli auth login \
  --url http://localhost:8787 \
  --key mn_...
```

You can also skip the credentials file with environment variables:

```bash
export MNEMIS_API_URL=http://localhost:8787
export MNEMIS_API_KEY=mn_test_...
```

Register sources:

```bash
bun run cli repos add owner/repo \
  --branch main \
  --installation 12345 \
  --strategy webhook

bun run cli docs add https://docs.example.com \
  --include /api \
  --exclude /blog \
  --max-pages 100 \
  --crawler auto

bun run cli docs add https://docs.example.com \
  --strategy cron \
  --cron "0 3 * * *"
```

Search indexed content and manage memories:

```bash
bun run cli search "how is indexing scheduled?" --mode markdown

bun run cli memory save \
  --kind fact \
  --title "Indexer queue" \
  --summary "Sources enqueue an index_source job" \
  --body "Repos and docs use /v1/sources with enqueue=true."

bun run cli memory list --kind fact --tag architecture
bun run cli memory search "indexer queue"
bun run cli memory update <memory-id> --tag architecture --no-ttl
bun run cli memory delete <memory-id>
bun run cli memory delete <memory-id> --permanent --yes
bun run cli status
```

Operational commands:

```bash
bun run cli sources get <source-id>
bun run cli sources status <source-id>
bun run cli sources reindex <source-id>

bun run cli github installations list
bun run cli github installations register \
  --installation 12345 \
  --account owner \
  --account-type Organization \
  --repository-selection selected \
  --event push
```

Credentials are stored at `$MNEMIS_CREDENTIALS_FILE` when set, otherwise at
`$XDG_CONFIG_HOME/mnemis/credentials.json` or `$HOME/.config/mnemis/credentials.json`.

## TypeScript SDK

Use `@mnemis/sdk` from workspace packages to avoid duplicating HTTP client
logic:

```ts
import { createMnemisClient } from '@mnemis/sdk';

const client = createMnemisClient({
  apiUrl: process.env.MNEMIS_API_URL ?? 'http://localhost:8787',
  apiKey: process.env.MNEMIS_API_KEY!,
});

const source = await client.sources.create({
  kind: 'github_repo',
  identifier: 'owner/repo',
  config: { branch: 'main' },
  indexStrategy: 'webhook',
  enqueue: true,
});

await client.sources.create({
  kind: 'docs_site',
  identifier: 'https://docs.example.com',
  config: { docsCrawler: 'auto', maxPages: 100 },
  indexStrategy: 'cron',
  cronSchedule: '0 3 * * *',
  enqueue: true,
});

const results = await client.search({
  query: 'contextual retrieval',
  mode: 'markdown',
  kinds: ['github_repo'],
  limit: 5,
});

const memory = await client.memories.create({
  kind: 'fact',
  title: 'Useful decision',
  summary: 'Short summary for retrieval',
  body: 'Full body text.',
  agentOrigin: 'custom-integration',
});

const memories = await client.memories.list({
  kind: 'fact',
  tag: 'architecture',
  includeArchived: false,
});

await client.sources.reindex(source.data.id);

console.log(source.data.id, results.count, memory.id, memories.total);
```

The SDK throws `MnemisApiError` for non-2xx responses and preserves the HTTP
status, API error code, message, and response details.
Set `timeoutMs` on `createMnemisClient` to bound API calls; timeouts throw
`MnemisTimeoutError`, while transport failures throw `MnemisNetworkError`.

`config.localPath` is intentionally disabled by default because it lets API
users ask the worker to read local server files. It requires all of:
`MNEMIS_ALLOW_LOCAL_SOURCES=true`, `MNEMIS_LOCAL_SOURCE_ROOTS` allowlisting the
path root, and an API key with `sources:local`. Keep it off for hosted/cloud
deployments.

Docs crawling defaults to `docsCrawler: 'auto'`: it uses Firecrawl when
`FIRECRAWL_API_KEY` is configured and otherwise falls back to the native
same-origin crawler.

Search reranking is optional and supports two providers:

- `MNEMIS_RERANK_PROVIDER=voyage` plus `VOYAGE_API_KEY` — calls Voyage's
  rerank-2.5 API on the post-fusion candidate pool. Lowest latency, requires
  internet egress.
- `MNEMIS_RERANK_PROVIDER=local` — runs `Xenova/bge-reranker-base` locally
  via `@huggingface/transformers` (ONNX runtime, q8 quantization, ~120 MB
  on disk). The model downloads on first use into the Transformers cache
  directory; subsequent reranks are local-only. Override the model with
  `MNEMIS_LOCAL_RERANK_MODEL=<huggingface-id>`. The default was the
  smaller-but-publicly-downloadable BGE base because the
  `Xenova/bge-reranker-v2-m3` repository is currently gated on Hugging
  Face and fails with `Unauthorized` on first download.

Our 2026-05-20 baseline shows Voyage rerank lifts nDCG@10 from 0.19 → 0.50
(+160%) on top of plain BM25, while the local BGE-base cross-encoder lifts
it to 0.41 (+115%). Hybrid retrieval *without* a reranker underperforms
keyword on highly lexical queries — pair hybrid with rerank to get the
full benefit. Full numbers in
[`reports/2026-05-20-baseline.md`](../reports/2026-05-20-baseline.md).

Leaving `MNEMIS_RERANK_PROVIDER` unset keeps the pure Postgres BM25 + vector
RRF fusion already used today.

## Retrieval benchmark

`packages/eval/data/mnemis-self/queries.json` ships a small curated dataset
that questions the Mnemis repo itself. Run it against a live API + worker
to compare retrieval variants:

```bash
export MNEMIS_API_URL=http://localhost:8787
export MNEMIS_API_KEY=mn_test_...
bun run benchmark
```

The script registers a one-off source with `config.localPath` pointing at the
repo root, waits for indexing, runs every query under `keyword` and `hybrid`
retrieval, and prints nDCG@10, MRR@10 and Recall@5. Set
`MNEMIS_RERANK_PROVIDER` on the API process to evaluate Voyage or local
rerank — the script reports the active provider for traceability.
