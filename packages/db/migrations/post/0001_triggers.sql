-- ============================================================================
-- Mnemis post-migrate triggers
-- ----------------------------------------------------------------------------
-- Run *after* drizzle-kit push. Idempotent. Populates body_tsv columns and
-- expires_at via Postgres triggers so the application layer cannot forget.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  memories.body_tsv  (weighted: title > summary > body)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mnemis_memories_tsv() RETURNS trigger AS $$
BEGIN
  NEW.body_tsv :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')),   'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.body, '')),    'C') ||
    setweight(to_tsvector('english', array_to_string(NEW.tags, ' ')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS memories_tsv_trg ON memories;
CREATE TRIGGER memories_tsv_trg
  BEFORE INSERT OR UPDATE OF title, summary, body, tags ON memories
  FOR EACH ROW EXECUTE FUNCTION mnemis_memories_tsv();

-- ----------------------------------------------------------------------------
--  memories.expires_at  (computed from created_at + ttl_seconds)
--  Skipped when ttl_seconds IS NULL (permanent memory).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mnemis_memories_expires() RETURNS trigger AS $$
BEGIN
  IF NEW.ttl_seconds IS NULL THEN
    NEW.expires_at := NULL;
  ELSE
    NEW.expires_at := COALESCE(NEW.created_at, now()) + (NEW.ttl_seconds || ' seconds')::interval;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS memories_expires_trg ON memories;
CREATE TRIGGER memories_expires_trg
  BEFORE INSERT OR UPDATE OF ttl_seconds, created_at ON memories
  FOR EACH ROW EXECUTE FUNCTION mnemis_memories_expires();

-- ----------------------------------------------------------------------------
--  memories.updated_at  (auto-bump on UPDATE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mnemis_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS memories_updated_at_trg ON memories;
CREATE TRIGGER memories_updated_at_trg
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION mnemis_set_updated_at();

DROP TRIGGER IF EXISTS sources_updated_at_trg ON sources;
CREATE TRIGGER sources_updated_at_trg
  BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION mnemis_set_updated_at();

DROP TRIGGER IF EXISTS research_runs_updated_at_trg ON research_runs;
CREATE TRIGGER research_runs_updated_at_trg
  BEFORE UPDATE ON research_runs
  FOR EACH ROW EXECUTE FUNCTION mnemis_set_updated_at();

DROP TRIGGER IF EXISTS research_run_sources_updated_at_trg ON research_run_sources;
CREATE TRIGGER research_run_sources_updated_at_trg
  BEFORE UPDATE ON research_run_sources
  FOR EACH ROW EXECUTE FUNCTION mnemis_set_updated_at();

DROP TRIGGER IF EXISTS github_app_installations_updated_at_trg ON github_app_installations;
CREATE TRIGGER github_app_installations_updated_at_trg
  BEFORE UPDATE ON github_app_installations
  FOR EACH ROW EXECUTE FUNCTION mnemis_set_updated_at();

-- ----------------------------------------------------------------------------
--  chunks.body_tsv  (raw_text + contextual_prefix, weighted)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mnemis_chunks_tsv() RETURNS trigger AS $$
BEGIN
  NEW.body_tsv :=
    setweight(to_tsvector('english', coalesce(NEW.contextual_prefix, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.path, '')),               'B') ||
    setweight(to_tsvector('english', coalesce(NEW.raw_text, '')),           'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chunks_tsv_trg ON chunks;
CREATE TRIGGER chunks_tsv_trg
  BEFORE INSERT OR UPDATE OF raw_text, contextual_prefix, path ON chunks
  FOR EACH ROW EXECUTE FUNCTION mnemis_chunks_tsv();
