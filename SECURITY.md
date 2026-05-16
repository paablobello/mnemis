# Security Policy

## Reporting a vulnerability

If you discover a security issue in Mnemis, please **do not open a public issue**.

Instead, email the maintainers privately. Include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce.
- Any suggested mitigations.

We will acknowledge receipt within 72 hours and aim to provide a fix or mitigation timeline within 7 days for critical issues.

## Supported versions

Until Mnemis reaches v1.0, only the latest commit on `main` is supported. Once we tag v1.0 we will document a support window for previous minors.

## Scope

In-scope:

- The Mnemis API server, MCP server, CLI, and workers.
- Auth and access control (API keys, workspaces).
- Indexing pipelines (repo and docs crawlers).
- Database access patterns and migrations.

Out of scope:

- Third-party services we depend on (Voyage AI, Anthropic, Cohere, Firecrawl). Report to those vendors directly.
- Self-hosted deployments misconfigured by the operator (e.g., exposing Postgres to the internet without a firewall).
