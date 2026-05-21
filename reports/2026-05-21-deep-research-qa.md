# Deep Research QA - 2026-05-21

Workspace: `deep-research-qa-20260521012804-f6c48ce5` / `ea0e1a17-b244-4a70-b9fa-816e5a8743be`

## Environment
- `TAVILY_API_KEY`: set
- `EXA_API_KEY`: set
- `FIRECRAWL_API_KEY`: set
- `OPENALEX_EMAIL`: set
- `SEMANTIC_SCHOLAR_API_KEY`: empty
- `VOYAGE_API_KEY`: set
- `ANTHROPIC_API_KEY`: set
- `MNEMIS_PDF_EXTRACTOR_URL`: set
- `MNEMIS_DEEP_QA_FORCE_SIDECAR`: empty
- PDF sidecar health: `null`

## Checks
### PASS - web discovery: Tavily + Exa candidates
- Duration: 3660ms

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
      "title": "useActionState - React",
      "url": "https://react.dev/reference/react/useActionState"
    },
    {
      "provider": "tavily",
      "kind": "web_page",
      "title": "The Guide to New Hooks in React 19 - Telerik.com",
      "url": "https://www.telerik.com/blogs/guide-new-hooks-react-19"
    },
    {
      "provider": "tavily",
      "kind": "web_page",
      "title": "How #useActionState simplifies React 19 forms - LinkedIn",
      "url": "https://www.linkedin.com/posts/jiyaagrawal_reactjs-tip-useactionstate-activity-7376204540649324544-y4bz"
    },
    {
      "provider": "tavily",
      "kind": "web_page",
      "title": "Simplify Form Handling in React 19: Introducing `useActionState ...",
      "url": "https://www.senvio.com/blog/simplify-form-handling-in-react-19-introducing-use"
    },
    {
      "provider": "tavily",
      "kind": "web_page",
      "title": "React useActionState Hook - Codefinity",
      "url": "https://codefinity.com/blog/React-useActionState-Hook"
    }
  ]
}
```

### PASS - academic discovery: papers and PDFs
- Duration: 1139ms

```json
{
  "candidates": 12,
  "providers": {
    "openalex": 12
  },
  "issues": [
    "semantic_scholar: HTTP 429: {\"message\": \"Too Many Requests. Please wait and try again or apply for a key for higher rate limits. https://www.semanticscholar.org/product/api#api-key-form\", \"code\": \"429\"}",
    "arxiv: HTTP 429: Rate exceeded."
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
- Duration: 738ms

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
- Duration: 365ms

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
- Duration: 11321ms

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
- Duration: 393ms

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

### PASS - live contextual prefix: one chunk
- Duration: 1608ms

```json
{
  "generated": 1,
  "eligible": 1,
  "skipped": 0,
  "skippedReason": null,
  "model": "claude-haiku-4-5",
  "sample": "This is the complete document content. The chunk represents the entire document, which discusses key requirements for evaluating Retrieval-Augmented Generation (RAG) systems, including source discovery, document indexing"
}
```

### PASS - research run: seed URLs: docs + blog + PDF
- Duration: 32101ms

```json
{
  "run_id": "c095ddca-a2d7-4dd6-9db0-23918eb55e39",
  "job_id": "c3530d60-d3fa-4705-a895-102a1311a3ae",
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
- Duration: 10469ms

```json
{
  "run_id": "807fb656-e159-4eea-94c8-f4cd0a3b71eb",
  "job_id": "848f0501-afb7-4362-9c97-641c655c332d",
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
      "identifier": "https://react.dev/reference/react/useActionState",
      "provider": "tavily,exa",
      "chunks": 42,
      "embedded": 42,
      "embedding_models": {
        "voyage-4-large": 42
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
- Duration: 3442ms

```json
{
  "run_id": "010ffd0f-017b-4a48-9c22-0845539ff8d8",
  "job_id": "ae23a340-c942-427b-a587-eb9756fce844",
  "processed": true,
  "status": "completed",
  "error": null,
  "candidates": 1,
  "indexed_sources": 1,
  "failed_sources": 0,
  "issues": [
    "semantic_scholar: HTTP 429: {\"message\": \"Too Many Requests. Please wait and try again or apply for a key for higher rate limits. https://www.semanticscholar.org/product/api#api-key-form\", \"code\": \"429\"}",
    "arxiv: HTTP 429: Rate exceeded."
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
    "score": 0.22985312342643738,
    "snippet": "# useActionState in React: A practical guide with examples - LogRocket Blog [**Advisory boards aren’t only for executives. Join the LogRocket Content Advisory Board today →**](https://lp.logrocket.com/blg/content-advisor"
  },
  {
    "kind": "web_page",
    "identifier": "https://www.telerik.com/blogs/guide-new-hooks-react-19",
    "path": "blogs/guide-new-hooks-react-19.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.1280297189950943,
    "snippet": "### Example: A Feedback Form Let’s walk through a practical example to illustrate how `useActionState` can be applied in a real-world scenario. Assume we wanted to build a simple feedback form that allows users to submit"
  },
  {
    "kind": "web_page",
    "identifier": "https://blog.logrocket.com/react-useactionstate",
    "path": "react-useactionstate.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.07894603908061981,
    "snippet": "## Working with multiple `useActionState` Hooks So far, we’ve seen how `useActionState` can simplify a single interaction, like submitting a form or toggling a like button. But what happens when you have multiple indepen"
  },
  {
    "kind": "web_page",
    "identifier": "https://blog.logrocket.com/react-useactionstate",
    "path": "react-useactionstate.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.06334158778190613,
    "snippet": "## What is `useActionState`? At a high level, `useActionState` is [a React Hook](https://blog.logrocket.com/react-hooks-cheat-sheet-solutions-common-problems/) that ties a user action (like submitting a form) to a piece "
  },
  {
    "kind": "web_page",
    "identifier": "https://blog.logrocket.com/react-useactionstate",
    "path": "react-useactionstate.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.06233510747551918,
    "snippet": "### Form submission Now let’s take it a step further. Beyond simple counters, `useActionState` really shines in real-world scenarios like handling [form submissions](https://blog.logrocket.com/react-hook-form-complete-gu"
  },
  {
    "kind": "web_page",
    "identifier": "https://www.senvio.com/blog/simplify-form-handling-in-react-19-introducing-use",
    "path": "blog/simplify-form-handling-in-react-19-introducing-use.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.050797659903764725,
    "snippet": "# Simplify Form Handling in React 19: Introducing \\`useActionState\\` Hook ![](https://images.prismic.io/webscope-web-2025/aQNhQ7pReVYa31hx_use-action-state.png?auto=format,compress) React 19's new `useActionState` hook s"
  }
]
```

### attention heads decoder encoder

```json
[
  {
    "kind": "pdf_document",
    "identifier": "https://arxiv.org/pdf/1706.03762",
    "path": "pdf/1706.03762/page-5.md",
    "page": 5,
    "crawler_provider": null,
    "pdf_extractor": "unpdf",
    "score": 0.3333333432674408,
    "snippet": "# arxiv.org"
  },
  {
    "kind": "pdf_document",
    "identifier": "https://arxiv.org/pdf/1706.03762",
    "path": "pdf/1706.03762/page-5.md",
    "page": 5,
    "crawler_provider": null,
    "pdf_extractor": "unpdf",
    "score": 0.2416989505290985,
    "snippet": "## Page 5 output values. These are concatenated and once again projected, resulting in the final values, as depicted in Figure 2. Multi-head attention allows the model to jointly attend to information from different repr"
  },
  {
    "kind": "pdf_document",
    "identifier": "https://arxiv.org/pdf/1706.03762",
    "path": "pdf/1706.03762/page-3.md",
    "page": 3,
    "crawler_provider": null,
    "pdf_extractor": "unpdf",
    "score": 0.09509450197219849,
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