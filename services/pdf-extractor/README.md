# Mnemis PDF Extractor

High-quality PDF extraction sidecar for Mnemis. It receives PDF bytes from the
TypeScript worker, extracts RAG-ready markdown with Docling, enriches scientific
paper metadata with GROBID when available, and returns page-level content for
citations.

## Local Docker

```bash
docker compose -f docker/docker-compose.yml --profile pdf up -d pdf-extractor grobid
```

Then set:

```env
MNEMIS_PDF_EXTRACTOR_URL=http://localhost:8790/extract
```

## Contract

Request:

```json
{
  "url": "https://arxiv.org/pdf/1706.03762",
  "content_type": "application/pdf",
  "content_sha256": "...",
  "content_base64": "JVBERi0x..."
}
```

Response:

```json
{
  "title": "Attention Is All You Need",
  "pages": [{ "page": 1, "markdown": "...", "text": "..." }],
  "metadata": {
    "extractor": "docling-grobid",
    "docling": { "pages": 15 },
    "grobid": { "doi": "...", "references": [] }
  }
}
```

If GROBID fails, Docling output is still returned and the error is recorded in
metadata. If Docling fails, the service returns a non-2xx response so Mnemis can
fall back to `unpdf` when `pdfExtractor: "auto"`.

