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
  --max-pages 100

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

`config.localPath` is intentionally disabled by default because it lets API
users ask the worker to read local server files. Use it only in trusted local
development with `MNEMIS_ALLOW_LOCAL_SOURCES=true`.
