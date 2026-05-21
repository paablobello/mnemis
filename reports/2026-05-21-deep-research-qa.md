# Deep Research QA - 2026-05-21

Workspace: `deep-research-qa-20260521021019-54a73e5d` / `db09c843-4c09-4e73-ac45-6b6f0effafb7`

## Environment
- `TAVILY_API_KEY`: set
- `EXA_API_KEY`: set
- `FIRECRAWL_API_KEY`: set
- `OPENALEX_EMAIL`: set
- `SEMANTIC_SCHOLAR_API_KEY`: empty
- `VOYAGE_API_KEY`: set
- `ANTHROPIC_API_KEY`: set
- `MNEMIS_PDF_EXTRACTOR_URL`: set
- `MNEMIS_DEEP_QA_FORCE_SIDECAR`: set
- PDF sidecar health: `{"ok":true,"docling_available":true,"grobid_enabled":true}`

## Checks
### PASS - web discovery: Tavily + Exa candidates
- Duration: 4347ms

```json
{
  "candidates": 12,
  "providers": {
    "tavily": 12,
    "exa": 3
  },
  "issues": [
    "brave: brave_not_configured"
  ],
  "top": [
    {
      "provider": "tavily,exa",
      "kind": "web_page",
      "title": "useActionState in React: A practical guide with examples",
      "url": "https://blog.logrocket.com/react-useactionstate"
    },
    {
      "provider": "tavily",
      "kind": "web_page",
      "title": "The Guide to New Hooks in React 19",
      "url": "https://www.telerik.com/blogs/guide-new-hooks-react-19"
    },
    {
      "provider": "tavily",
      "kind": "web_page",
      "title": "How #useActionState simplifies React 19 forms with server actions | Jiya Agrawal posted on the topic",
      "url": "https://www.linkedin.com/posts/jiyaagrawal_reactjs-tip-useactionstate-activity-7376204540649324544-y4bz"
    },
    {
      "provider": "tavily",
      "kind": "web_page",
      "title": "Simplify Form Handling in React 19: Introducing `useActionState` Hook | Senvio",
      "url": "https://www.senvio.com/blog/simplify-form-handling-in-react-19-introducing-use"
    },
    {
      "provider": "tavily",
      "kind": "web_page",
      "title": "Form Handling: useActionState Hook | React 19 - YouTube",
      "url": "https://www.youtube.com/watch?v=Rf1bLZGQoL4"
    }
  ]
}
```

### PASS - academic discovery: papers and PDFs
- Duration: 838ms

```json
{
  "candidates": 12,
  "providers": {
    "openalex": 12
  },
  "issues": [
    "semantic_scholar: HTTP 429: {\"message\": \"Too Many Requests. Please wait and try again or apply for a key for higher rate limits. https://www.semanticscholar.org/product/api#api-key-form\", \"code\": \"429\"}"
  ],
  "top": [
    {
      "provider": "openalex",
      "title": "A Survey of Large Language Models",
      "pdfUrl": "https://link.springer.com/content/pdf/10.1007/s11704-026-60308-3.pdf",
      "doi": "10.1007/s11704-026-60308-3",
      "year": 2026
    },
    {
      "provider": "openalex",
      "title": "Large Language Models for Information Retrieval: A Survey",
      "pdfUrl": "https://arxiv.org/pdf/2308.07107",
      "doi": "10.48550/arxiv.2308.07107",
      "year": 2023
    },
    {
      "provider": "openalex",
      "title": "Development and validation of an autonomous artificial intelligence agent for clinical decision-maki",
      "pdfUrl": "https://www.nature.com/articles/s43018-025-00991-6.pdf",
      "doi": "10.1038/s43018-025-00991-6",
      "year": 2025
    },
    {
      "provider": "openalex",
      "title": "Retrieval-Augmented Generation (RAG) in Healthcare: A Comprehensive Review",
      "pdfUrl": "https://www.mdpi.com/2673-2688/6/9/226/pdf?version=1757581602",
      "doi": "10.3390/ai6090226",
      "year": 2025
    },
    {
      "provider": "openalex",
      "title": "The Semantic Scholar Open Data Platform",
      "pdfUrl": "https://arxiv.org/pdf/2301.10140",
      "doi": "10.48550/arxiv.2301.10140",
      "year": 2023
    },
    {
      "provider": "openalex",
      "title": "From text to insight: large language models for chemical data extraction",
      "pdfUrl": "https://pubs.rsc.org/en/content/articlepdf/2025/cs/d4cs00913d",
      "doi": "10.1039/d4cs00913d",
      "year": 2024
    }
  ]
}
```

### PASS - direct index: React docs web page
- Duration: 726ms

```json
{
  "files": 1,
  "chunks": 42,
  "chars": 35364,
  "pages": 0,
  "crawler_provider": "firecrawl",
  "pdf_extractor": null,
  "pdf_auto_decision": null,
  "sample_path": "reference/react/useActionState.md",
  "sample_title": "# useActionState – React"
}
```

### PASS - direct index: technical blog web page
- Duration: 333ms

```json
{
  "files": 1,
  "chunks": 15,
  "chars": 17240,
  "pages": 0,
  "crawler_provider": "firecrawl",
  "pdf_extractor": null,
  "pdf_auto_decision": null,
  "sample_path": "react-useactionstate.md",
  "sample_title": "# useActionState in React: A practical guide with examples - LogRocket Blog"
}
```

### PASS - direct index: docs site crawl
- Duration: 14475ms

```json
{
  "files": 3,
  "chunks": 64,
  "chars": 43165,
  "pages": 0,
  "crawler_provider": "firecrawl",
  "pdf_extractor": null,
  "pdf_auto_decision": null,
  "sample_path": "api-reference/endpoint/scrape.md",
  "sample_title": "# Scrape - Firecrawl Docs"
}
```

### PASS - direct index: arXiv PDF auto fast path
- Duration: 365ms

```json
{
  "files": 15,
  "chunks": 31,
  "chars": 40032,
  "pages": 15,
  "crawler_provider": null,
  "pdf_extractor": "unpdf",
  "pdf_auto_decision": "native_text_sufficient",
  "sample_path": "pdf/1706.03762/page-1.md",
  "sample_title": "# pdf/1706.03762"
}
```

### PASS - direct index: arXiv PDF sidecar forced
- Duration: 71917ms

```json
{
  "files": 15,
  "chunks": 37,
  "chars": 54335,
  "pages": 15,
  "crawler_provider": null,
  "pdf_extractor": "sidecar",
  "pdf_auto_decision": null,
  "sample_path": "pdf/1706.03762/page-1.md",
  "sample_title": "# Attention Is All You Need"
}
```

### PASS - live contextual prefix: one chunk
- Duration: 1326ms

```json
{
  "generated": 1,
  "eligible": 1,
  "skipped": 0,
  "skippedReason": null,
  "model": "claude-haiku-4-5",
  "sample": "RAG evaluation framework covering modern research agent capabilities including source discovery, PDF and blog indexing, page-level citation requirements, and retrieval benchmark criteria for assessing source quality, emb"
}
```

### PASS - research run: seed URLs: docs + blog + PDF
- Duration: 26144ms

```json
{
  "run_id": "06e3b7c5-59c1-4d63-b46b-361e551aa45f",
  "job_id": "9b6ca6d6-7521-4eef-aef6-eb8a9aac1c91",
  "processed": true,
  "status": "completed",
  "error": null,
  "candidates": 3,
  "indexed_sources": 3,
  "failed_sources": 0,
  "issues": [],
  "link_statuses": {
    "indexed": 3
  },
  "indexed": [
    {
      "kind": "web_page",
      "identifier": "https://react.dev/reference/react/useActionState",
      "provider": "seed_url",
      "chunks": 42,
      "embedded": 42,
      "embedding_models": {
        "voyage-4-large": 42
      }
    },
    {
      "kind": "web_page",
      "identifier": "https://blog.logrocket.com/react-useactionstate",
      "provider": "seed_url",
      "chunks": 15,
      "embedded": 15,
      "embedding_models": {
        "voyage-4-large": 15
      }
    },
    {
      "kind": "pdf_document",
      "identifier": "https://arxiv.org/pdf/1706.03762",
      "provider": "seed_url",
      "chunks": 31,
      "embedded": 31,
      "embedding_models": {
        "voyage-4-large": 31
      }
    }
  ],
  "failed": []
}
```

### PASS - research run: web discovery + indexing
- Duration: 10123ms

```json
{
  "run_id": "a88545ca-06c6-44f6-80ee-eb275a446ae2",
  "job_id": "f7775fa7-2d4d-4cd7-a2c3-7ecda672b893",
  "processed": true,
  "status": "completed",
  "error": null,
  "candidates": 4,
  "indexed_sources": 3,
  "failed_sources": 1,
  "issues": [
    "brave: brave_not_configured"
  ],
  "link_statuses": {
    "indexed": 3,
    "failed": 1
  },
  "indexed": [
    {
      "kind": "web_page",
      "identifier": "https://blog.logrocket.com/react-useactionstate",
      "provider": "tavily,exa",
      "chunks": 15,
      "embedded": 15,
      "embedding_models": {
        "voyage-4-large": 15
      }
    },
    {
      "kind": "web_page",
      "identifier": "https://www.telerik.com/blogs/guide-new-hooks-react-19",
      "provider": "tavily",
      "chunks": 26,
      "embedded": 26,
      "embedding_models": {
        "voyage-4-large": 26
      }
    },
    {
      "kind": "web_page",
      "identifier": "https://www.senvio.com/blog/simplify-form-handling-in-react-19-introducing-use",
      "provider": "tavily",
      "chunks": 4,
      "embedded": 4,
      "embedding_models": {
        "voyage-4-large": 4
      }
    }
  ],
  "failed": [
    {
      "kind": "web_page",
      "identifier": "https://www.linkedin.com/posts/jiyaagrawal_reactjs-tip-useactionstate-activity-7376204540649324544-y4bz",
      "provider": "tavily",
      "error": "robots.txt disallows crawling /posts/jiyaagrawal_reactjs-tip-useactionstate-activity-7376204540649324544-y4bz"
    }
  ]
}
```

### PASS - research run: academic paper discovery + indexing (bounded)
- Duration: 2498ms

```json
{
  "run_id": "8aaf76cc-db17-4708-86b7-71acb973422b",
  "job_id": "57dee2ed-6145-46c3-a10f-9b53b7c3a75b",
  "processed": true,
  "status": "completed",
  "error": null,
  "candidates": 1,
  "indexed_sources": 1,
  "failed_sources": 0,
  "issues": [
    "semantic_scholar: HTTP 429: {\"message\": \"Too Many Requests. Please wait and try again or apply for a key for higher rate limits. https://www.semanticscholar.org/product/api#api-key-form\", \"code\": \"429\"}"
  ],
  "link_statuses": {
    "indexed": 1
  },
  "indexed": [
    {
      "kind": "academic_paper",
      "identifier": "https://drops.dagstuhl.de/entities/document/10.4230/OASIcs.LDK.2019.21",
      "provider": "openalex",
      "chunks": 19,
      "embedded": 19,
      "embedding_models": {
        "voyage-4-large": 19
      }
    }
  ],
  "failed": []
}
```

## Indexed Sources
- `academic_paper` https://drops.dagstuhl.de/entities/document/10.4230/OASIcs.LDK.2019.21: status=indexed, chunks=19, pages=0, embedded=19, crawler=firecrawl, pdf=n/a
- `pdf_document` https://arxiv.org/pdf/1706.03762: status=indexed, chunks=31, pages=15, embedded=31, crawler=n/a, pdf=unpdf
- `web_page` https://blog.logrocket.com/react-useactionstate: status=indexed, chunks=15, pages=0, embedded=15, crawler=firecrawl, pdf=n/a
- `web_page` https://react.dev/reference/react/useActionState: status=indexed, chunks=42, pages=0, embedded=42, crawler=firecrawl, pdf=n/a
- `web_page` https://www.linkedin.com/posts/jiyaagrawal_reactjs-tip-useactionstate-activity-7376204540649324544-y4bz: status=failed, chunks=0, pages=0, embedded=0, crawler=n/a, pdf=n/a
- `web_page` https://www.senvio.com/blog/simplify-form-handling-in-react-19-introducing-use: status=indexed, chunks=4, pages=0, embedded=4, crawler=firecrawl, pdf=n/a
- `web_page` https://www.telerik.com/blogs/guide-new-hooks-react-19: status=indexed, chunks=26, pages=0, embedded=26, crawler=firecrawl, pdf=n/a

## Search Checks
### useActionState form action state

```json
[
  {
    "kind": "web_page",
    "identifier": "https://blog.logrocket.com/react-useactionstate",
    "path": "react-useactionstate.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.4137371778488159,
    "snippet": "### No signup required Check it out Galileo AI Overview - May 2025 ![Video Thumbnail](https://embed-ssl.wistia.com/deliveries/d13588ad6864cb4841845467c9b8feb8.webp?image_crop_resized=1920x1079) 1:15 Click for sound Manag"
  },
  {
    "kind": "web_page",
    "identifier": "https://www.telerik.com/blogs/guide-new-hooks-react-19",
    "path": "blogs/guide-new-hooks-react-19.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.2643061876296997,
    "snippet": "### Example: A Feedback Form Let’s walk through a practical example to illustrate how `useActionState` can be applied in a real-world scenario. Assume we wanted to build a simple feedback form that allows users to submit"
  },
  {
    "kind": "web_page",
    "identifier": "https://react.dev/reference/react/useActionState",
    "path": "reference/react/useActionState.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.1428571492433548,
    "snippet": "## Usage [Link for Usage ](https://react.dev/reference/react/useActionState\\#usage \"Link for Usage \")"
  },
  {
    "kind": "web_page",
    "identifier": "https://react.dev/reference/react/useActionState",
    "path": "reference/react/useActionState.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.10337243974208832,
    "snippet": "### My Action cannot read form data [Link for My Action cannot read form data ](https://react.dev/reference/react/useActionState\\#action-cannot-read-form-data \"Link for My Action cannot read form data \") When you use `us"
  },
  {
    "kind": "web_page",
    "identifier": "https://react.dev/reference/react/useActionState",
    "path": "reference/react/useActionState.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.10000000149011612,
    "snippet": "## Troubleshooting [Link for Troubleshooting ](https://react.dev/reference/react/useActionState\\#troubleshooting \"Link for Troubleshooting \")"
  },
  {
    "kind": "web_page",
    "identifier": "https://react.dev/reference/react/useActionState",
    "path": "reference/react/useActionState.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.06472563743591309,
    "snippet": "# useActionState [Link for this heading](https://react.dev/reference/react/useActionState\\#undefined \"Link for this heading\") `useActionState` is a React Hook that lets you update state with side effects using [Actions]("
  }
]
```

### attention heads decoder encoder

```json
[
  {
    "kind": "pdf_document",
    "identifier": "https://arxiv.org/pdf/1706.03762",
    "path": "pdf/1706.03762/page-3.md",
    "page": 3,
    "crawler_provider": null,
    "pdf_extractor": "unpdf",
    "score": 0.04986967891454697,
    "snippet": "## Page 3 Figure 1: The Transformer - model architecture. The Transformer follows this overall architecture using stacked self-attention and point-wise, fully connected layers for both the encoder and decoder, shown in t"
  },
  {
    "kind": "pdf_document",
    "identifier": "https://arxiv.org/pdf/1706.03762",
    "path": "pdf/1706.03762/page-10.md",
    "page": 10,
    "crawler_provider": null,
    "pdf_extractor": "unpdf",
    "score": 0.04285714402794838,
    "snippet": "## Page 10 Table 4: The Transformer generalizes well to English constituency parsing (Results are on Section 23 of WSJ) Parser Training WSJ 23 F1 Vinyals & Kaiser el al. (2014) [37] WSJ only, discriminative 88.3 Petrov e"
  },
  {
    "kind": "pdf_document",
    "identifier": "https://arxiv.org/pdf/1706.03762",
    "path": "pdf/1706.03762/page-5.md",
    "page": 5,
    "crawler_provider": null,
    "pdf_extractor": "unpdf",
    "score": 0.02857142873108387,
    "snippet": "## Page 5 output values. These are concatenated and once again projected, resulting in the final values, as depicted in Figure 2. Multi-head attention allows the model to jointly attend to information from different repr"
  },
  {
    "kind": "pdf_document",
    "identifier": "https://arxiv.org/pdf/1706.03762",
    "path": "pdf/1706.03762/page-2.md",
    "page": 2,
    "crawler_provider": null,
    "pdf_extractor": "unpdf",
    "score": 0.0021921733859926462,
    "snippet": "## Page 2 1 Introduction Recurrent neural networks, long short-term memory [13] and gated recurrent [7] neural networks in particular, have been firmly established as state of the art approaches in sequence modeling and "
  },
  {
    "kind": "pdf_document",
    "identifier": "https://arxiv.org/pdf/1706.03762",
    "path": "pdf/1706.03762/page-1.md",
    "page": 1,
    "crawler_provider": null,
    "pdf_extractor": "unpdf",
    "score": 0.0010000000474974513,
    "snippet": "## Page 1 Provided proper attribution is provided, Google hereby grants permission to reproduce the tables and figures in this paper solely for use in journalistic or scholarly works. Attention Is All You Need Ashish Vas"
  }
]
```

### retrieval augmented generation reranking citations

```json
[]
```

## Hard Failures
- None.

## Distilled Assessment
- Discovery and extraction are intentionally separated: Tavily/Exa/OpenAlex/arXiv/Crossref find candidates; Firecrawl/Docling/native extractors turn selected URLs into indexed chunks.
- PDF `auto` mode is latency-first: native text extraction handles text-rich papers, while the Docling/GROBID sidecar is reserved for sparse/scanned PDFs or explicit `pdfExtractor=sidecar` runs.
- A user research flow should prefer `includeWeb=true`, `includePapers=true`, `includePdfs=true`, `index=true`, and a modest `maxSources` first; then expand or force premium PDF extraction only if results are weak.
- Critical quality signals are: multiple providers represented, sources indexed despite provider failures, page metadata on PDFs, crawler/extractor metadata on chunks, and search hits from the indexed workspace.