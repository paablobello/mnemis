-- Extensions required by Mnemis. Runs once at first container start.

-- pgvector: vector type + HNSW / IVF indexes
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_trgm: trigram similarity (used for fuzzy lookups, e.g. file path search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- pgcrypto: gen_random_uuid() for default uuid pks
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- citext: case-insensitive text (used for email comparisons later)
CREATE EXTENSION IF NOT EXISTS citext;
