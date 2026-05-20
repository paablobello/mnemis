# Mnemis — Tech Decisions (Phase 0 deliverable)

> **Estado**: v1 — decisiones técnicas tomadas tras research sobre competidores y SOTA.
> **Fecha**: 2026-05-16.
> **Input para Fase 1** (scaffolding del repo en Semana 2).

Este documento es el deliverable de la Fase 0. Para cada componente clave del MVP, registra: opciones consideradas, decisión final, justificación con evidencia, riesgos asumidos.

> Nota de implementación: este documento conserva el objetivo técnico investigado.
> El estado actual del repo está en README y docs operativas: Firecrawl y Voyage
> rerank son opcionales, TypeScript/JavaScript usan AST del compilador
> TypeScript, Python usa chunking por indentación, y la búsqueda léxica actual
> es Postgres `tsvector`/`ts_rank_cd`, no BM25 nativo.

---

## Resumen ejecutivo de decisiones

| Componente | Decisión MVP | Por qué |
|---|---|---|
| Backend lang | **TypeScript everywhere** (Bun CLI/MCP, Node 22 API/workers) | Ecosistema MCP en TS. Una sola lengua reduce fricción. |
| DB | **Postgres 16 + pgvector + tsvector** | Una sola DB. AGPL evitado en MVP (ParadeDB en v0.2). |
| Embeddings cloud | **voyage-3.5-large** general, **voyage-code-3** repos | Top MTEB, mejor en código. 1024 dims, 32K context. |
| Embeddings self-host | **BGE-M3** (1024 dims, multilingüe) | Open source robusto, similar dims a Voyage para compat. |
| Reranker | **mxbai-rerank-large-v2** (Qwen 2.5 base, ONNX) | **57.49 nDCG@10 BEIR — supera Cohere/Voyage/bge**. Open source. |
| Reranker fallback | bge-reranker-v2-m3 | Más liviano para self-host modesto. |
| Reranker API option | Cohere rerank-3.5 | Para users que prefieren cloud. Pro tier opcional. |
| Contextual chunking | **Anthropic Contextual Retrieval** | 35% → 49% → 67% reduction (CR / CR+BM25 / +rerank). $1.02/M tokens con caching. |
| Contextualization LLM | Claude Haiku 4.5 (con prompt caching) | Anthropic recomienda explícitamente. Caching baja coste 90%. |
| Code chunking | **tree-sitter AST + Parent-child** | cAST paper (2026). Parent-child sube 69% → 78-82% accuracy. |
| BM25 fusion | **RRF (Reciprocal Rank Fusion)** | Más robusto que weighted sum, no necesita normalización. |
| Memory model | **Mem0 v3 style: ADD-only + entity linking** | Single-pass extraction. v3 batió LoCoMo de 71.4 → 91.6 y LongMemEval 67.8 → 94.8. |
| Crawler docs | **Firecrawl** (self-hostable) | Open source, output Markdown limpio, soporta `llms.txt`. |
| Jobs queue | **BullMQ + Redis** (cloud) / **pg-boss** (self-host minimal) | Standard TS ecosystem. pg-boss evita Redis dep en self-host. |
| GraphRAG / Knowledge graph | **NO en MVP** | Demasiado caro y complejo. Considerar para v0.2 como capa opcional. |
| Late Chunking (Jina) | **NO en MVP** | Solo Jina embeddings, gains marginales sobre Contextual Retrieval. |
| Temporal validity (Graphiti) | **NO en MVP** | Diseñar campos para activarlo en v0.2 sin migration. |

---

## 1. Memory architecture

### Competidores estudiados

| Sistema | Modelo | Insight clave |
|---|---|---|
| **Mem0 v3** (abril 2026) | ADD-only + entity linking + multi-signal retrieval | Eliminaron UPDATE/DELETE — solo añaden. LoCoMo 71.4→91.6, LongMemEval 67.8→94.8. |
| **Letta / MemGPT** | Memory blocks attachable a agentes, system prompt pinning | Modelo simple: blocks como strings con tool calls del LLM para modificarlos. |
| **Graphiti (Zep)** | Temporal knowledge graph, bi-temporal (valid_from/valid_to) | Facts se invalidan, no se borran. Sub-200ms claim. Backends: Neo4j/FalkorDB/Kuzu/Neptune. |
| **Cognee** | Knowledge graph + vector hybrid | API minimal (remember/recall/forget/improve). Auto-routing de estrategia de búsqueda. |
| **Nia** | Contextos con memory_type + TTL + lineage | Modelo cognitivo (scratchpad/episodic/fact/procedural). Cerrado. |

### Decisión Mnemis

**Adoptar el modelo Mem0 v3 (ADD-only + entity linking) como base**, combinado con TTL configurable de Nia. NO temporal validity (Graphiti) ni knowledge graph (Cognee/GraphRAG) en MVP.

**Vocabulario propio** (no copia léxica de ningún competidor):
- `memories` (no `contexts` como Nia, no `blocks` como Letta).
- `kind`: `working` (1h TTL) / `session` (7d) / `fact` (∞) / `procedural` (∞).
- Campos: id, workspace_id, user_id, agent_origin, kind, title, summary, body, tags, directory, file_overlap, ttl_seconds, expires_at, archived_at, source_ids, derived_from, confidence, tool_calls, model_version, edited_files, metadata, embedding, body_tsv, created_at, updated_at.

**Por qué Mem0 v3 over Letta**: el modelo de Letta requiere que el LLM razone sobre paging — más coste de tokens y más fragilidad. Mem0 v3 es zero-config para el agente: solo `save()` y `search()`.

**Por qué NO temporal validity en MVP**: Graphiti tiene mucha potencia pero introduce complejidad de queries (`AS OF timestamp`) y dudas sobre cómo se invalidan facts automáticamente. Diseñar la schema con `superseded_by` y `valid_until` opcionales — permite añadirlo en v0.2 sin migration.

**Por qué NO knowledge graph en MVP**: Cognee y GraphRAG son potentes para "holistic questions" pero (a) requieren entity extraction sobre todo el corpus (caro), (b) añaden una DB más (Neo4j/Kuzu), (c) los gains son marcados solo en preguntas que un grep no podría responder. Para devs con repos+docs, hybrid search alcanza. Añadir como capa opcional en v0.2.

**Riesgos asumidos**:
- Sin entity resolution explícito, dos memorias sobre la misma entidad serán duplicados separados. Mitigación: dedup por hash de body en save.
- Sin temporal validity, "qué era verdad cuando" no se puede contestar. Aceptable para MVP.

---

## 2. Embeddings

### Modelos evaluados

| Modelo | Tipo | Dims | Context | Notas |
|---|---|---|---|---|
| **voyage-3.5-large** | Cloud | 1024 (adj) | 32K | Top general. Recomendado por Voyage. |
| **voyage-code-3** | Cloud | 1024 (adj) | 32K | Optimizado código. |
| **voyage-4-large** | Cloud | 1024 (adj) | 32K | Más reciente (mayo 2026). Mejor MTEB todavía. |
| **voyage-4-nano** | Open weight | n/a | n/a | En HuggingFace. Sin benchmarks claros aún. |
| **OpenAI text-embedding-3-large** | Cloud | 3072 | 8K | Bueno general, contexto limitado. |
| **Cohere embed-v3** | Cloud | 1024 | 512 (chunk-y) | Context limitadísimo. Descartado para docs largos. |
| **BGE-M3** | Open source | 1024 | 8K | Multilingüe, multi-funcional (dense+sparse+colbert). Estándar self-host. |

### Decisión Mnemis

- **Cloud default**: **voyage-3.5-large** (a migrar a voyage-4-large cuando esté GA si benchmarks lo justifican).
- **Cloud code**: **voyage-code-3** para chunks de repos.
- **Self-host**: **BGE-M3** (1024 dims, mismo que Voyage para schema compatibility).
- **input_type** parameter:
  - `input_type='document'` al indexar.
  - `input_type='query'` al buscar.

**Coste estimado** (Voyage pricing aproximado, verificar antes de ir live):
- Indexar 1M tokens de docs ≈ $0.12.
- Indexar 1M tokens de código con voyage-code-3 ≈ $0.18.

**Riesgos**:
- Voyage lock-in mitigado por BGE-M3 self-host con mismo dim (1024). Migration trivial: re-index.
- Si voyage-4 cambia dims (`voyage-4-large` permite 256/512/1024/2048), elegimos 1024 para compat con BGE-M3.

---

## 3. Reranking

### Modelos evaluados

| Modelo | nDCG@10 BEIR | Params | Latencia | Tipo |
|---|---|---|---|---|
| **mxbai-rerank-large-v2** | **57.49** | (Qwen 2.5 base, RL-trained) | ~moderate | Open source |
| **Cohere rerank-3.5** | (no public) | (API) | 595-603ms | Cloud API |
| **bge-reranker-v2-m3** | 51.8 | 278M | Fast | Open source, lightweight |
| **Voyage rerank-2** | (no public) | (API) | (API) | Cloud API |

### Decisión Mnemis

- **Primary**: **mxbai-rerank-large-v2** servido localmente vía ONNX runtime (Node tiene `onnxruntime-node`) o llama.cpp.
- **Lightweight fallback** (self-host con poca RAM): **bge-reranker-v2-m3**.
- **Cloud API option** (config setting): **Cohere rerank-3.5**.

**Por qué mxbai sobre bge**: 5.7 puntos nDCG es enorme. Open source. La base Qwen 2.5 con RL training es state-of-the-art reciente.

**Estrategia de hosting**:
- Cloud Mnemis: servicio Python dedicado con FastAPI + Modal/Replicate como inference layer (margen escalable).
- Self-host: ONNX en proceso Node si la latencia es aceptable; fallback a microservicio Python si no.

**Pipeline final** (combinando todo):
```
query → embed (Voyage query) → vector search top-50 (pgvector HNSW)
                              + BM25 search top-50 (tsvector)
                              ↓
                       RRF fusion top-50
                              ↓
                  mxbai-rerank-large-v2 → top-10
                              ↓
                         response
```

---

## 4. Contextual Retrieval (Anthropic, sept 2024)

### Decisión Mnemis

**Adoptar al 100%**. Prompt literal de Anthropic:

```
<document>
{{WHOLE_DOCUMENT}}
</document>
Here is the chunk we want to situate within the whole document
<chunk>
{{CHUNK_CONTENT}}
</chunk>
Please give a short succinct context to situate this chunk within the
overall document for the purposes of improving search retrieval of the
chunk. Answer only with the succinct context and nothing else.
```

- **Modelo**: Claude Haiku 4.5 (Anthropic recomienda Haiku 3.5; usamos la más reciente).
- **Prompt caching**: SÍ — `{{WHOLE_DOCUMENT}}` en cache, `{{CHUNK_CONTENT}}` varía. Coste ~$1.02/M tokens.
- **Storage**: prefijo concatenado al chunk antes de embedear AND antes de indexar en BM25.

**Mejoras medidas (Anthropic)**:
- Solo embeddings contextualizados: **5.7% → 3.7% retrieval failure (35% reducción)**.
- + Contextual BM25: 5.7% → 2.9% (49% reducción).
- + rerank: 5.7% → 1.9% (67% reducción).

**Riesgo**: latencia de indexación sube (1 LLM call por chunk). Mitigación: batch + prompt caching agresivo. Indexar es async desde día 1 (job queue).

**Decisión de UX**: en MVP, **siempre on para docs**, **opt-in para código** (puede no añadir tanto valor en repos cuando los chunks son funciones autocontenidas). Validar con benchmark propio antes del launch.

---

## 5. Code chunking

### Estado del arte (2026)

- **AST-based con tree-sitter** es estándar (Cursor, Windsurf, Copilot, Aider, Continue lo usan).
- **cAST paper** (arxiv 2506.15655) formaliza la práctica: 4 goals — syntactic integrity, high density, language invariance, plug-and-play.
- **Parent-child chunking** es **el truco con mejor ROI en 2026**: parent grande (1000 tokens) en docstore, child pequeño (200 tokens) embedded, match en children → retrieval expande a parent.
  - Gains medidos: **69% → 78-82% accuracy** (+10-13 pp) con casi zero coste de API extra.

### Decisión Mnemis

- **tree-sitter** para AST parsing. Lenguajes v1: **TypeScript, JavaScript, JSX, TSX, Python, Go, Rust, Java**.
- **Parent-child chunking**:
  - Parent: función completa, clase, o módulo (hasta ~1000 tokens).
  - Child: bloques sintácticos internos (200 tokens approx) si la función es larga.
  - Schema: `chunks` table tiene `parent_id uuid REFERENCES chunks(id) NULL`. Query devuelve parent expandido.
- **Contextual Retrieval prefix** opt-in para código (a benchmarkar en Semana 4).
- **Fallback** para lenguajes sin parser: chunking por líneas con overlap.

**Implementación**:
- Librerías TS: `tree-sitter-typescript`, `tree-sitter-python`, etc. via WASM o native bindings.
- Considerar `@continuedev/ast-chunking` si está actualizado, o implementar propio.

---

## 6. Docs chunking

### Decisión Mnemis

- **Estructural por sección** (h1/h2/h3) por defecto. Mantener `section_path` en metadata.
- **Semantic chunking fallback** para docs sin estructura clara — implementación propia con embeddings de oraciones + threshold.
- **Contextual Retrieval prefix** SIEMPRE en docs (gains documentados de Anthropic).
- **Tamaño objetivo**: 400-800 tokens por chunk.

---

## 7. Hybrid search & fusion

### Decisión Mnemis

- **Vector**: pgvector HNSW (`m=16, ef_construction=64`, `ef_search=40` runtime).
- **Lexical**: tsvector + pg_trgm para MVP. ParadeDB (Tantivy) evaluado en v0.2.
- **Fusion**: **RRF (Reciprocal Rank Fusion)** con `k=60` (estándar). No weighted sum.
- **Reranker** post-fusion (sección 3).

**Por qué RRF**:
- No requiere normalización de scores (vector score y BM25 score están en escalas distintas).
- Robusto a outliers.
- Implementable como CTE en SQL puro, eficiente.

**Query SQL conceptual**:
```sql
WITH vec_top AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $query_vec) as rank
  FROM chunks WHERE workspace_id = $ws ORDER BY embedding <=> $query_vec LIMIT 50
),
bm25_top AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(body_tsv, $query_tsq) DESC) as rank
  FROM chunks WHERE workspace_id = $ws AND body_tsv @@ $query_tsq LIMIT 50
)
SELECT id, COALESCE(1.0/(60 + v.rank), 0) + COALESCE(1.0/(60 + b.rank), 0) as score
FROM vec_top v FULL OUTER JOIN bm25_top b USING (id)
ORDER BY score DESC LIMIT 50;
```

Después se pasa el top-50 al reranker para top-10 final.

---

## 8. BM25: ParadeDB vs tsvector

### Comparación

| Aspecto | tsvector + pg_trgm | ParadeDB pg_search |
|---|---|---|
| **Origen** | Built-in Postgres | Extensión (Tantivy/Rust) |
| **Calidad ranking** | OK (ts_rank, ts_rank_cd) | Mejor (BM25 nativo) |
| **Sintaxis** | `tsquery`/`tsvector` con `@@` | Sintaxis SQL custom |
| **Performance** | Buena hasta ~100K docs | Mejor en escala |
| **Deps extra** | Cero | Extensión a instalar |
| **Licencia** | PostgreSQL license | AGPL-3.0 |
| **Madurez** | Décadas | Joven, en activo desarrollo |
| **Self-host** | Trivial | Requiere build de extensión |

### Decisión Mnemis

- **MVP**: **tsvector + pg_trgm**. Zero deps, suficiente calidad para corpus iniciales (<1M chunks).
- **v0.2**: evaluar migración a ParadeDB cuando tengamos datos reales de calidad y escala.

**AGPL no es bloqueador** dado nuestro modelo open core (somos open source). Pero la madurez es el factor: tsvector está probado en producción durante años; ParadeDB todavía está iterando.

**Migration path**: schema preparada con `body_tsv` ahora. Cuando migremos, swap a la sintaxis de pg_search es localizado.

---

## 9. Crawler

### Decisión Mnemis

- **Firecrawl** como default (open source self-hostable, output Markdown limpio, soporta `llms.txt`).
- **crawl4ai** como segunda opción si Firecrawl tiene fricciones.
- Filtros: `include_paths`, `exclude_paths`, `focus_instructions` (NL filter via Claude Haiku).
- Recrawl: cron diario por defecto. On-demand via API. Cambio detectado por hash MD5 del contenido.

---

## 10. Stack final consolidado

```
┌─────────────────────────────────────────────┐
│  Cliente: Cursor / Claude Code / Codex / …  │
└──────────────────┬──────────────────────────┘
                   │ MCP / REST
                   │
┌──────────────────▼──────────────────────────┐
│  Mnemis API (Hono + Node 22)                │
│  - Auth: Clerk (cloud) / Better Auth (SH)   │
│  - Rate limit + usage tracking              │
└────┬─────────────┬──────────────┬───────────┘
     │             │              │
┌────▼─────┐  ┌───▼──────┐   ┌────▼──────────┐
│ Memory   │  │ Search   │   │ Index (jobs)  │
│ API      │  │ API      │   │ + GH webhooks │
└────┬─────┘  └────┬─────┘   └────┬──────────┘
     │             │              │
     ▼             ▼              ▼
┌─────────────────────────────────────────────┐
│  Postgres 16                                │
│  - pgvector (HNSW, 1024 dims)               │
│  - tsvector + pg_trgm                       │
│  - tables: memories, sources, chunks (w/    │
│    parent_id), jobs, workspaces, …          │
└─────────────────────────────────────────────┘

External services:
- Voyage AI (embeddings)
- Claude Haiku 4.5 (contextual prefix, optional synthesis)
- mxbai-rerank-large-v2 (ONNX local o Python service)
- Firecrawl (docs crawler)
- Redis (BullMQ in cloud) / pg-boss (in self-host)
```

---

## 11. Open questions para Fase 1

1. **Parent-child storage**: ¿una sola tabla `chunks` con `parent_id` self-FK, o dos tablas (`parent_chunks` y `child_chunks`)? Decisión leaning hacia una tabla con FK opcional (más simple, queries más naturales).
2. **Reranker hosting en self-host**: ONNX en Node (libfile size ~600MB para mxbai) vs microservicio Python dedicado. Probar ambos en Semana 4.
3. **Contextual Retrieval para código**: aplicar a TODOS los chunks o solo a chunks ambiguos? Benchmark con/sin en Semana 4.
4. **¿Hacer embedding del chunk con o sin contextual prefix?** Anthropic recomienda CON. Confirmar con benchmark propio.
5. **Benchmarks reproducibles**: ¿usar BEIR + LoCoMo + LongMemEval? Construir un benchmark interno con preguntas reales de devs sobre repos+docs (más relevante para el use case del MVP).

---

## 12. Datasets para validación (Semana 4)

Para medir calidad de retrieval objetivamente:

- **BEIR** — benchmark general de retrieval.
- **LoCoMo** — long-context conversational memory (usado por Mem0).
- **LongMemEval** — long-term memory (usado por Mem0 v3).
- **Custom Mnemis bench**: 100 preguntas reales sobre repos populares (react, next.js, anthropic-sdk-python) + sus docs. Ground truth construida a mano.

---

## 13. Referencias

### Memory architectures
- Mem0 v3 — https://github.com/mem0ai/mem0
- Letta / MemGPT — https://github.com/letta-ai/letta + https://docs.letta.com
- Graphiti / Zep — https://github.com/getzep/graphiti
- Cognee — https://github.com/topoteretes/cognee
- A-MEM paper — https://arxiv.org/abs/2502.12110

### Retrieval techniques
- **Anthropic Contextual Retrieval** — https://www.anthropic.com/news/contextual-retrieval (deeply applied)
- Jina Late Chunking — https://jina.ai/news/late-chunking-in-long-context-embedding-models/ (skipped MVP)
- Microsoft GraphRAG — https://microsoft.github.io/graphrag/ (skipped MVP)
- cAST chunking paper — https://arxiv.org/html/2506.15655v1

### Embeddings & rerankers
- Voyage AI docs — https://docs.voyageai.com/docs/embeddings
- BGE-M3 — https://huggingface.co/BAAI/bge-m3
- mxbai-rerank-large-v2 — https://huggingface.co/mixedbread-ai/mxbai-rerank-large-v2
- bge-reranker-v2-m3 — https://huggingface.co/BAAI/bge-reranker-v2-m3
- Reranker benchmarks — https://aimultiple.com/rerankers

### Infrastructure
- ParadeDB — https://github.com/paradedb/paradedb
- pgvector — https://github.com/pgvector/pgvector
- Firecrawl — https://www.firecrawl.dev
- tree-sitter — https://tree-sitter.github.io

---

## Baseline retrieval — 2026-05-20

First reproducible measurement of the retrieval stack against the curated
`packages/eval/data/mnemis-self/queries.json` dataset (10 queries on the
Mnemis repo itself, commit `1385e1e`). Full report:
[`reports/2026-05-20-baseline.md`](../../reports/2026-05-20-baseline.md).

| variant                | nDCG@10 | MRR@10 | Recall@5 |
| ---------------------- | ------- | ------ | -------- |
| keyword (no rerank)    | 0.197   | 0.233  | 0.192    |
| keyword + local rerank | 0.433   | 0.481  | 0.317    |

The local BGE-base cross-encoder more than doubles nDCG and MRR over plain
Postgres BM25 in this corpus, and lifts Recall@5 by ~65 %. Voyage embeddings
and Voyage rerank were not measured (no `VOYAGE_API_KEY` configured); fill
that in and rerun `bun run benchmark` to fill the missing rows.

Default local model is now `Xenova/bge-reranker-base` (q8 ONNX, ~120 MB on
disk). `Xenova/bge-reranker-v2-m3` is currently gated on Hugging Face and
fails with `Unauthorized` on first download — override via
`MNEMIS_LOCAL_RERANK_MODEL` once that gating is lifted.
