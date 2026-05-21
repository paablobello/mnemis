# Live research smoke - 2026-05-20

Scope: validate the newly implemented research/discovery/indexing path against real providers and
real remote content. Secrets were not printed.

## Environment

- Web providers configured and tested: Tavily, Exa.
- Brave intentionally not configured.
- Academic providers tested: OpenAlex, arXiv, Crossref path available; Semantic Scholar returned
  rate limiting without an API key, which is expected.
- Firecrawl is supported for docs crawls and single-page `web_page` scraping when
  `FIRECRAWL_API_KEY` is set.
- PDF sidecar is implemented with Docling + optional GROBID. Local `.env` points
  `MNEMIS_PDF_EXTRACTOR_URL` at `http://localhost:8790/extract`; live smoke can still fall back to
  native `unpdf` if that sidecar is not running.

## Deterministic tests

- `bun --filter @mnemis/indexer test`: pass, 15 tests.
- `DATABASE_URL=postgres://mnemis:mnemis_dev@localhost:5433/mnemis MNEMIS_ALLOW_LOCAL_SOURCES=true bun --filter @mnemis/worker test`: pass, 32 tests.
- `DATABASE_URL=postgres://mnemis:mnemis_dev@localhost:5433/mnemis INTERNAL_AUTH_SECRET=test-secret MNEMIS_ALLOW_LOCAL_SOURCES=true bun --filter @mnemis/api test`: pass, 73 tests.
- `DATABASE_URL=postgres://mnemis:mnemis_dev@localhost:5433/mnemis INTERNAL_AUTH_SECRET=test-secret MNEMIS_ALLOW_LOCAL_SOURCES=true bun run test --force`: pass, 10/10 tasks.
- `bun run typecheck`: pass.
- `bun run lint`: pass.
- `python3 -m py_compile services/pdf-extractor/app/main.py`: pass.
- `docker compose -f docker/docker-compose.yml --profile pdf config`: pass.
- `POSTGRES_PASSWORD=test INTERNAL_AUTH_SECRET=test docker compose -f docker/docker-compose.prod.yml --profile pdf config`: pass.
- `docker compose -f docker/docker-compose.yml --profile pdf build pdf-extractor`: pass.
- `docker run --rm mnemis-pdf-extractor python -c "from app.main import DocumentConverter; ..."`:
  pass, `docling_available=True`.

## Live discovery

### Web-only query

Query: `React 19 use action state form actions technical guide`

Result:

- 10 candidates returned.
- Providers represented: Tavily, Exa, and Tavily+Exa deduped overlaps.
- Expected issue: `brave_not_configured`.

Representative URLs included:

- `https://react.dev/reference/react/useActionState`
- `https://blog.logrocket.com/react-useactionstate`
- technical blog and GitHub discussion results.

### Academic query

Query: `Next.js App Router server actions best practices 2026`

Result:

- 8 candidates returned from OpenAlex.
- Expected issue: Semantic Scholar returned HTTP 429 because no API key is configured.
- Brave was intentionally unconfigured.

## Live extraction/indexing

Direct extractor smoke tests:

- `buildWebPageIndex("https://react.dev/reference/react/useActionState")`
  - 1 file, 36 chunks, 29,424 chars.
- `buildDocsSiteIndex("https://react.dev/reference/react", { maxPages: 4 })`
  - 4 files, 96 chunks, 52,233 chars.
- `buildWebPageIndex("https://blog.logrocket.com/react-useactionstate/")`
  - 1 file, 21 chunks, 15,918 chars.
- `buildPdfDocumentIndex("https://arxiv.org/pdf/1706.03762")`
  - 15 page files, 42 chunks, 40,032 chars.

## Live worker pipeline

Repeated via:

```bash
bun --env-file=.env scripts/research-live-smoke.ts
```

The smoke creates an isolated workspace and queues one research job with seed URLs:

- React technical docs page.
- LogRocket technical blog article.
- arXiv PDF: `https://arxiv.org/pdf/1706.03762`.

Final run:

- Status: completed.
- Candidates: 3.
- Indexed sources: 3.
- Failed sources: 0.
- Issues: none.

Indexed sources:

- `pdf_document` `https://arxiv.org/pdf/1706.03762`
  - 31 chunks, 15 pages, 31 embeddings.
- `web_page` `https://blog.logrocket.com/react-useactionstate`
  - 15 chunks, 15 embeddings.
- `web_page` `https://react.dev/reference/react/useActionState`
  - 42 chunks, 42 embeddings.

Embeddings:

- Voyage was used successfully with `voyage-4-large`.
- 88/88 chunks embedded.
- Contextual prefixes were intentionally disabled in this smoke by clearing `ANTHROPIC_API_KEY`
  inside the smoke script to avoid many live Anthropic calls during repeatable QA.

Search checks:

- Query `useActionState form action state` returned relevant hits from both the blog and React docs.
- Query `attention heads decoder encoder` returned arXiv PDF hits with page metadata, including pages
  3, 10, 5, 2, and 1.

## Fixes made during smoke

- Fixed PDF URL classification for arXiv-style paths such as `/pdf/1706.03762`, which do not end in
  `.pdf`.
- Added worker test coverage for arXiv-style PDF seed URLs.
- Added Firecrawl `/scrape` support for single `web_page` sources, preserving crawler metadata and
  falling back to the native extractor in `auto` mode.
- Added a Dockerized PDF sidecar using Docling for layout-aware markdown and optional GROBID
  metadata extraction.
- Added `scripts/research-live-smoke.ts` for repeatable live E2E checks.
- Preserved per-source indexing metrics in `research_runs.result.sources[*].indexing`.
- Fixed generic completed job progress so research jobs no longer rely on a `chunks` field.

## Remaining caveats

- Semantic Scholar can work without a key but may return 429; this is expected until a key is added.
- The Docling image builds and imports successfully, but it is heavy because current Linux wheels pull
  PyTorch and CUDA dependencies. For production, consider pinning a CPU-only Torch stack or replacing
  the custom image with an official Docling serving image if image size/startup time becomes a
  deployment issue.
- Native `unpdf` remains as automatic fallback when `pdfExtractor: "auto"` and the sidecar is down.
- Live smoke data remains in the local dev database under `smoke-research-*` workspaces for manual
  inspection.
