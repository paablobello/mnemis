# CLI and TypeScript SDK

Mnemis exposes the same HTTP API through `@mnemis/sdk` and the `@mnemis/cli`
workspace package. Both expect a running API and a bearer API key.

## CLI

During development, run the CLI through the workspace script:

```bash
bun --filter @mnemis/cli start help
```

Authenticate once and store credentials locally:

```bash
bun --filter @mnemis/cli start auth login \
  --url http://localhost:8787 \
  --key mn_test_...
```

You can also skip the credentials file with environment variables:

```bash
export MNEMIS_API_URL=http://localhost:8787
export MNEMIS_API_KEY=mn_test_...
```

Register sources:

```bash
bun --filter @mnemis/cli start repos add owner/repo \
  --branch main \
  --installation 12345 \
  --strategy webhook

bun --filter @mnemis/cli start docs add https://docs.example.com \
  --include /api \
  --exclude /blog \
  --max-pages 100
```

Search indexed content and manage memories:

```bash
bun --filter @mnemis/cli start search "how is indexing scheduled?" --mode markdown

bun --filter @mnemis/cli start memory save \
  --kind fact \
  --title "Indexer queue" \
  --summary "Sources enqueue an index_source job" \
  --body "Repos and docs use /v1/sources with enqueue=true."

bun --filter @mnemis/cli start memory search "indexer queue"
bun --filter @mnemis/cli start status
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

console.log(source.data.id, results.count, memory.id);
```

The SDK throws `MnemisApiError` for non-2xx responses and preserves the HTTP
status, API error code, message, and response details.
