-- ============================================================================
-- Mnemis hardening constraints
-- ----------------------------------------------------------------------------
-- Backfills enum-like check constraints for existing databases. New databases get
-- these constraints from the Drizzle schema; this script only adds missing ones
-- so repeat `db:push:ci` runs do not drop/re-add them.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_members'::regclass
      AND conname = 'workspace_members_role_check'
  ) THEN
    ALTER TABLE workspace_members
      ADD CONSTRAINT workspace_members_role_check
        CHECK (role IN ('owner', 'admin', 'member'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sources'::regclass
      AND conname = 'sources_kind_check'
  ) THEN
    ALTER TABLE sources
      ADD CONSTRAINT sources_kind_check
        CHECK (kind IN (
          'github_repo',
          'docs_site',
          'web_page',
          'pdf_document',
          'academic_paper',
          'research_collection'
        ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sources'::regclass
      AND conname = 'sources_status_check'
  ) THEN
    ALTER TABLE sources
      ADD CONSTRAINT sources_status_check
        CHECK (status IN ('pending', 'indexing', 'indexed', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sources'::regclass
      AND conname = 'sources_index_strategy_check'
  ) THEN
    ALTER TABLE sources
      ADD CONSTRAINT sources_index_strategy_check
        CHECK (index_strategy IN ('manual', 'webhook', 'cron'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'memories'::regclass
      AND conname = 'memories_kind_check'
  ) THEN
    ALTER TABLE memories
      ADD CONSTRAINT memories_kind_check
        CHECK (kind IN ('working', 'session', 'fact', 'procedural'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'memories'::regclass
      AND conname = 'memories_confidence_check'
  ) THEN
    ALTER TABLE memories
      ADD CONSTRAINT memories_confidence_check
        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'jobs'::regclass
      AND conname = 'jobs_kind_check'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_kind_check
        CHECK (kind IN ('index_source', 'reindex_source', 'research_run', 'embed_chunks', 'rerank_warmup'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'jobs'::regclass
      AND conname = 'jobs_status_check'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_status_check
        CHECK (status IN ('queued', 'processing', 'completed', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'usage_events'::regclass
      AND conname = 'usage_events_kind_check'
  ) THEN
    ALTER TABLE usage_events
      ADD CONSTRAINT usage_events_kind_check
        CHECK (kind IN ('request', 'search', 'save', 'index', 'research', 'rerank', 'synthesize'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'research_runs'::regclass
      AND conname = 'research_runs_depth_check'
  ) THEN
    ALTER TABLE research_runs
      ADD CONSTRAINT research_runs_depth_check
        CHECK (depth IN ('quick', 'standard', 'deep'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'research_runs'::regclass
      AND conname = 'research_runs_status_check'
  ) THEN
    ALTER TABLE research_runs
      ADD CONSTRAINT research_runs_status_check
        CHECK (status IN ('queued', 'processing', 'completed', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'research_run_sources'::regclass
      AND conname = 'research_run_sources_status_check'
  ) THEN
    ALTER TABLE research_run_sources
      ADD CONSTRAINT research_run_sources_status_check
        CHECK (status IN ('pending', 'indexed', 'failed', 'skipped'));
  END IF;
END $$;
