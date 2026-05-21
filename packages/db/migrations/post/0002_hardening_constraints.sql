-- ============================================================================
-- Mnemis hardening constraints
-- ----------------------------------------------------------------------------
-- Idempotent check constraints for enum-like text columns. Drizzle owns table
-- shape; this layer prevents invalid states from scripts or operational fixes.
-- ============================================================================

ALTER TABLE workspace_members
  DROP CONSTRAINT IF EXISTS workspace_members_role_check,
  ADD CONSTRAINT workspace_members_role_check
    CHECK (role IN ('owner', 'admin', 'member'));

ALTER TABLE sources
  DROP CONSTRAINT IF EXISTS sources_kind_check,
  ADD CONSTRAINT sources_kind_check
    CHECK (kind IN (
      'github_repo',
      'docs_site',
      'web_page',
      'pdf_document',
      'academic_paper',
      'research_collection'
    ));

ALTER TABLE sources
  DROP CONSTRAINT IF EXISTS sources_status_check,
  ADD CONSTRAINT sources_status_check
    CHECK (status IN ('pending', 'indexing', 'indexed', 'failed'));

ALTER TABLE sources
  DROP CONSTRAINT IF EXISTS sources_index_strategy_check,
  ADD CONSTRAINT sources_index_strategy_check
    CHECK (index_strategy IN ('manual', 'webhook', 'cron'));

ALTER TABLE memories
  DROP CONSTRAINT IF EXISTS memories_kind_check,
  ADD CONSTRAINT memories_kind_check
    CHECK (kind IN ('working', 'session', 'fact', 'procedural'));

ALTER TABLE memories
  DROP CONSTRAINT IF EXISTS memories_confidence_check,
  ADD CONSTRAINT memories_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_kind_check,
  ADD CONSTRAINT jobs_kind_check
    CHECK (kind IN ('index_source', 'reindex_source', 'research_run', 'embed_chunks', 'rerank_warmup'));

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_status_check,
  ADD CONSTRAINT jobs_status_check
    CHECK (status IN ('queued', 'processing', 'completed', 'failed'));

ALTER TABLE usage_events
  DROP CONSTRAINT IF EXISTS usage_events_kind_check,
  ADD CONSTRAINT usage_events_kind_check
    CHECK (kind IN ('request', 'search', 'save', 'index', 'research', 'rerank', 'synthesize'));

ALTER TABLE research_runs
  DROP CONSTRAINT IF EXISTS research_runs_depth_check,
  ADD CONSTRAINT research_runs_depth_check
    CHECK (depth IN ('quick', 'standard', 'deep'));

ALTER TABLE research_runs
  DROP CONSTRAINT IF EXISTS research_runs_status_check,
  ADD CONSTRAINT research_runs_status_check
    CHECK (status IN ('queued', 'processing', 'completed', 'failed'));

ALTER TABLE research_run_sources
  DROP CONSTRAINT IF EXISTS research_run_sources_status_check,
  ADD CONSTRAINT research_run_sources_status_check
    CHECK (status IN ('pending', 'indexed', 'failed', 'skipped'));
