# Deep Research QA - 2026-05-21

Workspace: `deep-research-qa-20260521185510-d4ab9695` / `b3f4320b-1df2-43ee-bd04-7e672f7fb748`

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
- Duration: 1776ms

```json
{
  "candidates": 12,
  "providers": {
    "tavily": 12,
    "exa": 1
  },
  "issues": [
    "brave: brave_not_configured"
  ],
  "top": [
    {
      "provider": "tavily",
      "kind": "web_page",
      "title": "How #useActionState simplifies React 19 forms with server actions | Jiya Agrawal posted on the topic",
      "url": "https://www.linkedin.com/posts/jiyaagrawal_reactjs-tip-useactionstate-activity-7376204540649324544-y4bz"
    },
    {
      "provider": "tavily,exa",
      "kind": "web_page",
      "title": "useActionState - React",
      "url": "https://react.dev/reference/react/useActionState"
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
      "title": "React useActionState Hook",
      "url": "https://codefinity.com/blog/React-useActionState-Hook"
    },
    {
      "provider": "tavily",
      "kind": "web_page",
      "title": "Exploring React 19: New Features vs. Traditional Methods",
      "url": "https://devm.io/javascript/react-19-new-features"
    }
  ]
}
```

### PASS - academic discovery: papers and PDFs
- Duration: 2013ms

```json
{
  "candidates": 12,
  "providers": {
    "semantic_scholar": 12,
    "crossref": 1
  },
  "issues": [],
  "top": [
    {
      "provider": "semantic_scholar,crossref",
      "title": "Systematic Evaluation of Similarity Metrics for Retrieval, Reranking, and Completion in Retrieval Au",
      "pdfUrl": "",
      "doi": "10.1109/etecom66111.2025.11319066",
      "year": 2025
    },
    {
      "provider": "semantic_scholar",
      "title": "Correctness is not Faithfulness in Retrieval Augmented Generation Attributions",
      "pdfUrl": "",
      "doi": "10.1145/3731120.3744592",
      "year": 2025
    },
    {
      "provider": "semantic_scholar",
      "title": "Retrieval-Augmented Generation for Maternal Healthcare: Design and Evaluation of a Clinical Question",
      "pdfUrl": "",
      "doi": "10.1109/ENC68268.2025.11311944",
      "year": 2025
    },
    {
      "provider": "semantic_scholar",
      "title": "LLM-powered threat intelligence: a retrieval-augmented generation approach for cyber attack investig",
      "pdfUrl": "",
      "doi": "10.7717/peerj-cs.3371",
      "year": 2025
    },
    {
      "provider": "semantic_scholar",
      "title": "Rethinking Retrieval: From Traditional Retrieval Augmented Generation to Agentic and Non-Vector Reas",
      "pdfUrl": "",
      "doi": "10.48550/arXiv.2511.18177",
      "year": 2025
    },
    {
      "provider": "semantic_scholar",
      "title": "RAG-X: Density-Adaptive Path Sampling for Enhanced Knowledge Graph-Based Retrieval Augmented Generat",
      "pdfUrl": "",
      "doi": "10.1109/IConSCEPT66142.2025.11437293",
      "year": 2025
    }
  ]
}
```

### PASS - direct index: React docs web page
- Duration: 700ms

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
- Duration: 527ms

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
- Duration: 9187ms

```json
{
  "files": 3,
  "chunks": 64,
  "chars": 43190,
  "pages": 0,
  "crawler_provider": "firecrawl",
  "pdf_extractor": null,
  "pdf_auto_decision": null,
  "sample_path": "api-reference/endpoint/scrape.md",
  "sample_title": "# Scrape - Firecrawl Docs"
}
```

### PASS - direct index: arXiv PDF auto fast path
- Duration: 538ms

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
- Duration: 79441ms

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
- Duration: 1242ms

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
- Duration: 40937ms

```json
{
  "run_id": "caeccf3f-f0fb-48fc-b89a-7e04a8045ba1",
  "job_id": "462a7118-4a60-4d81-9c42-29d0112c67e9",
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
- Duration: 16248ms

```json
{
  "run_id": "b3d88377-c867-4633-a2d2-c65a2498291c",
  "job_id": "02ae0e43-9d78-4e5b-8787-76c83b849940",
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
    "failed": 1,
    "indexed": 3
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
      "identifier": "https://codefinity.com/blog/React-useActionState-Hook",
      "provider": "tavily",
      "chunks": 12,
      "embedded": 12,
      "embedding_models": {
        "voyage-4-large": 12
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
- Duration: 5697ms

```json
{
  "run_id": "1271e61b-b05a-4c5f-9a5e-5289154a0682",
  "job_id": "babd9330-eb60-4227-8d92-548f7964210d",
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
- `web_page` https://codefinity.com/blog/React-useActionState-Hook: status=indexed, chunks=12, pages=0, embedded=12, crawler=firecrawl, pdf=n/a
- `web_page` https://react.dev/reference/react/useActionState: status=indexed, chunks=42, pages=0, embedded=42, crawler=firecrawl, pdf=n/a
- `web_page` https://www.linkedin.com/posts/jiyaagrawal_reactjs-tip-useactionstate-activity-7376204540649324544-y4bz: status=failed, chunks=0, pages=0, embedded=0, crawler=n/a, pdf=n/a
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
    "identifier": "https://blog.logrocket.com/react-useactionstate",
    "path": "react-useactionstate.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.22261904180049896,
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
    "score": 0.09477764368057251,
    "snippet": "## Working with multiple `useActionState` Hooks So far, we’ve seen how `useActionState` can simplify a single interaction, like submitting a form or toggling a like button. But what happens when you have multiple indepen"
  },
  {
    "kind": "web_page",
    "identifier": "https://codefinity.com/blog/React-useActionState-Hook",
    "path": "blog/React-useActionState-Hook.md",
    "page": null,
    "crawler_provider": "firecrawl",
    "pdf_extractor": null,
    "score": 0.0731423944234848,
    "snippet": "## FAQs **Q**: What is the `useActionState` hook in React 19? **A**: `useActionState` is a new React 19 hook that simplifies form management by handling state updates, errors, and pending states automatically. It elimina"
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
    "score": 0.5068566799163818,
    "snippet": "## Page 5 output values. These are concatenated and once again projected, resulting in the final values, as depicted in Figure 2. Multi-head attention allows the model to jointly attend to information from different repr"
  },
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
    "path": "pdf/1706.03762/page-3.md",
    "page": 3,
    "crawler_provider": null,
    "pdf_extractor": "unpdf",
    "score": 0.09490399062633514,
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