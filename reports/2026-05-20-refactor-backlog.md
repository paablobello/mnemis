# Backlog técnico post-auditoría - 2026-05-20

## Objetivo

Convertir Mnemis de "alpha funcional" a "alpha pública sólida": sin
vulnerabilidades conocidas altas, con límites operativos reales, contratos
públicos confiables y degradación limpia ante fallos externos.

## P1 - Antes de abrir a usuarios externos

### 1. Actualizar Drizzle y cerrar `bun audit` - Hecho

Tarea:

- Subir `drizzle-orm` a `>=0.45.2` en `apps/api` y `packages/db`.
- Subir `drizzle-kit` a una versión compatible.
- Regenerar/validar schema si aplica.

Criterios de aceptación:

- `bun audit` no reporta GHSA-gpj5-g38j-94v9.
- `bun run lint`, `bun run typecheck`, `bun run build` y `bun run test` pasan.
- `bun run db:push:ci` pasa contra Postgres limpio.
- No hay cambios de schema no intencionales.

### 2. Endurecer límite de request body - Hecho

Tarea:

- Reemplazar el check basado solo en `Content-Length` por lectura limitada por
  bytes para JSON/text.
- Aplicar el límite también a `/v1/webhooks/github`.
- Mantener `MNEMIS_MAX_BODY_BYTES` como configuración única.

Criterios de aceptación:

- Request chunked sin `Content-Length` y body mayor al límite devuelve 413.
- Webhook GitHub mayor al límite devuelve 413 antes de parsear JSON.
- Requests válidos bajo límite siguen pasando.
- Tests cubren JSON inválido, body grande con y sin `Content-Length`, y webhook.

### 3. Validar instalaciones GitHub App server-side - Hecho parcial

Tarea:

- Cambiar el registro manual de instalaciones para que use callback GitHub App
  con `state` firmado, o validar la instalación con la GitHub App API antes de
  guardar.
- Al crear source `github_repo` con `githubInstallationId`, confirmar que el repo
  está accesible para esa instalación.

Criterios de aceptación:

- No se puede registrar un `installationId` arbitrario solo con `sources:write`.
- El workspace solo puede usar instalaciones verificadas para ese workspace.
- Source creation falla con error claro si el repo no pertenece a la instalación.
- Tests cubren instalación ajena, instalación inexistente y repo no autorizado.

### 4. Degradar fallos de providers externos - Hecho

Tarea:

- En indexing, tratar Anthropic contextual prefixes y Voyage embeddings como
  mejoras opcionales salvo configuración explícita de fail-fast.
- Guardar chunks keyword-only si embeddings fallan por 429/5xx/timeout.
- En memory save, guardar memoria sin embedding si Voyage falla
  transitoriamente.

Criterios de aceptación:

- Provider 429/5xx no impide crear memoria ni indexar texto.
- `job.result` indica `embedding_skipped_reason` o
  `contextual_prefix_skipped_reason` sanitizado.
- Errores permanentes de source siguen marcando job/source como failed.
- Tests cubren Anthropic 500, Voyage timeout y ausencia de API key.

### 5. Corregir contrato SDK/API de `/v1/search` - Hecho

Tarea:

- Ajustar `ChunkSearchItem` para reflejar la respuesta real del API.
- Añadir tests de contrato que comparen shape real de `/v1/search` con tipos
  públicos esperados.

Criterios de aceptación:

- El SDK no expone `n`/`chunk_id` en `items` salvo que el API los devuelva.
- `citations` sigue conteniendo la forma citation completa.
- Tests SDK cubren raw, markdown y synthesized.

## P2 - Robustez operativa

### 6. Rate limiting distribuido o explícitamente single-process - Hecho

Tarea:

- Para alpha pública, mover buckets a Postgres/Redis o implementar ventana sobre
  `usage_events`.
- Añadir configuración `TRUST_PROXY`/equivalente para decidir si se aceptan
  `x-forwarded-for` y `x-real-ip`.

Criterios de aceptación:

- Dos procesos API comparten límite para la misma API key.
- Sin trusted proxy, IP spoofing por header no cambia bucket.
- Headers `ratelimit-*` y `retry-after` siguen estables.

### 7. Idempotencia de cron con múltiples workers

Tarea:

- Añadir advisory lock o idempotency key por `(source_id, due_minute)`.
- Ejecutar enqueue cron en transacción.

Criterios de aceptación:

- Dos workers concurrentes no crean dos reindex jobs para el mismo source/minuto.
- Sigue permitiendo nuevo job en el siguiente due minute.
- Tests simulan llamadas concurrentes a `enqueueDueCronJobs`.

### 8. Retry/backoff para jobs fallidos transitorios

Tarea:

- Clasificar errores retryable: provider 429/5xx, fetch timeout, git timeout,
  Firecrawl timeout.
- Reprogramar `scheduledAt` con backoff y aumentar `attempts`.
- Mantener failed inmediato para validaciones permanentes.

Criterios de aceptación:

- Error retryable deja job en `queued` con `scheduledAt` futuro hasta
  `JOB_MAX_ATTEMPTS`.
- Al agotar intentos, job queda `failed` con error sanitizado.
- Source status distingue `pending retry` de `failed`.

### 9. Unificar configuración y guardrails compartidos

Tarea:

- Extraer parsing de env, booleanos, timeouts, local source roots y path
  allowlist a un paquete compartido.
- Hacer API y worker consumir los mismos helpers.

Criterios de aceptación:

- No hay dos implementaciones de `isPathUnderRoot`, `localSourceRoots` o boolean
  env parsing.
- Tests de API y worker siguen cubriendo localPath cloud/self-host.

## P3 - Limpieza, documentación y DX

### 10. Documentar arquitectura real

Tarea:

- Crear `docs/architecture.md` con estado actual: API, worker, jobs table,
  Postgres, retrieval, providers, Docker y límites.
- Marcar `docs/research/tech-decisions.md` como histórico.
- Actualizar README con limitaciones de alpha.

Criterios de aceptación:

- Un contribuidor puede entender el sistema actual sin leer el código.
- No hay contradicciones sobre BullMQ/pg-boss, Voyage default o reranker.

### 11. Añadir matriz de contratos públicos

Tarea:

- Documentar scopes por endpoint y por herramienta CLI/MCP.
- Añadir tests de contrato mínimos para REST -> SDK -> MCP en search/sources.

Criterios de aceptación:

- Cada endpoint público tiene scope esperado documentado.
- Cambiar un DTO de API rompe un test SDK/MCP si no se actualizan tipos.

### 12. Mejorar observabilidad mínima

Tarea:

- Estandarizar logs estructurados para API y worker.
- Añadir correlation/job ids en logs de jobs e indexing.
- Exponer métricas básicas: jobs queued/processing/failed, provider skips,
  indexing duration y request counts.

Criterios de aceptación:

- Un fallo de indexing se puede seguir de request -> job -> provider/source.
- Healthcheck sigue liviano; métricas van en endpoint separado o logs.

## Orden recomendado

1. Drizzle/audit.
2. Body limits.
3. GitHub installation validation.
4. Provider degradation.
5. SDK contract fix.
6. Rate limiting.
7. Cron idempotency y job retries.
8. Config shared helpers.
9. Docs/observability.
