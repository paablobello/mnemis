-- Extensions required before Drizzle creates schema objects.
-- The pgvector image ships the extension files, but each database still needs
-- CREATE EXTENSION before vector columns or HNSW indexes can be created.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
