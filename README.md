# Entity Registry — Backend

A NestJS + TypeORM + PostgreSQL API for the Entity Registry compliance-tracking
app: upload `entities.csv` / `ownership.csv` / `filings.csv` (or `.xlsx`
equivalents) together, get every validation error in one pass if anything is
wrong, or an atomic write if everything's clean. Serves a browsable
entity/subsidiary/FQ hierarchy with computed compliance status, and analytics
aggregates for the frontend's four charts.

Full domain spec, decisions, and schema: see `entity-registry-requirements-analysis.md`,
`entity-registry-db-design.md`, and `entity-registry-open-questions.md` in the
repo root one level up. This README covers running and deploying this service.

The companion frontend lives in a separate sibling repo (`client-app`) and is
deployed independently — a deliberate two-repo split, not a monorepo.

## Tech stack

- **NestJS 11** (Express platform)
- **TypeORM 0.3.x** + **PostgreSQL** — schema owned entirely by the migration
  in `src/database/migrations/` (CHECK constraints, a partial unique index on
  `business_id`); `synchronize` is off everywhere so there's no drift between
  what the migration says and what TypeORM infers from the entity classes.
- **csv-parse** and **xlsx** (SheetJS) for parsing uploads — both produce a
  plain `string[][]` matrix so the rest of the validation pipeline doesn't
  care which format came in.
- **Swagger** (`@nestjs/swagger`) for interactive API docs
- **Jest** for unit tests
- **Docker** (docker-compose for local Postgres, multi-stage Dockerfile for
  deployment)
- **Neon** (managed Postgres) + **Render** (hosting) for deployment

## Local setup

Requires Node 20.19+ or Node 22+, Docker, and an npm registry connection.

```bash
npm install
cp .env.example .env
docker compose up -d
npm run migration:run
npm run start:dev
```

Then check:

- `http://localhost:4000/api/health` — should return a healthy status
- `http://localhost:4000/api/docs` — Swagger UI with every endpoint

Notes:

- `docker compose up -d` starts a local Postgres 16 container **mapped to
  host port 5433, not 5432** (see `docker-compose.yml`) — deliberate, to
  avoid clashing with a Postgres instance already running on the default
  port locally. `.env.example`'s `DATABASE_URL` already points at 5433.
- There's no seed script. Upload `entities.csv` / `ownership.csv` /
  `filings.csv` from the repo root (one level up) through `POST /api/upload`
  to populate local data — see "Trying it against real data" below.

## API surface

Everything's under `/api`, documented interactively at `/api/docs`. The
three endpoints:

- **`POST /api/upload`** — `multipart/form-data` with three file fields:
  `entities`, `ownership`, `filings` (each `.csv` or single-sheet `.xlsx`).
  Returns `201` with row counts on success, or `422` with a full
  `{ errors: [{ file, line, column, message }, ...] }` list — every error in
  the batch, not just the first, spreadsheet-native line numbers (header =
  line 1). Nothing is written if `errors` is non-empty. Re-uploading is
  idempotent: rows are upserted by natural key (`entity_name`;
  `(parent, child)`; `(entity, filing_type, due_date)`), so re-running the
  same files never creates duplicates.
- **`GET /api/entities`** — top-level entities (no incoming ownership edge),
  each expandable to its direct FQs and subsidiaries (one level). Query
  params: `search`, `entityStatus`, `complianceStatus`, `jurisdiction`.
- **`GET /api/analytics`** — the four chart datasets. Query params:
  `jurisdiction`, `entityStatus`, `parentEntityId`.

Per-route internals (validation pipeline, compliance-status ladder, cycle
detection, aggregation logic) with Mermaid flow diagrams: see
[`docs/routes/`](docs/routes/README.md).

## Trying it against real data

The repo root (one level up) has a clean, deliberately-valid sample dataset —
`entities.csv`, `ownership.csv`, `filings.csv` — that exercises every branch
of the compliance ladder. With the server running:

```bash
curl -X POST http://localhost:4000/api/upload \
  -F "entities=@../entities.csv;type=text/csv" \
  -F "ownership=@../ownership.csv;type=text/csv" \
  -F "filings=@../filings.csv;type=text/csv"

curl http://localhost:4000/api/entities
curl http://localhost:4000/api/analytics
```

## Testing

```bash
npm test          # unit tests — no DB needed
```

- `src/registry/compliance/compliance.util.spec.ts` — the compliance-status
  ladder, every branch and every boundary (`d = 90`, `d = 0`, `d = -364`),
  plus the brief's own worked example (a Dissolved entity years overdue is
  `NOT_APPLICABLE`, not `SUSPENDED`).
- `src/registry/validation/graph-validator.spec.ts` — cycle detection
  (direct, multi-hop, and cycles that only close once merged with
  already-persisted edges), and the per-child >100% ownership check.
- `src/app.controller.spec.ts` — health check.

Manually verified end-to-end against the sample data above: all 12 rows'
compliance statuses match `entity-registry-db-design.md`'s worked table
exactly, `.xlsx` upload parses identically to `.csv`, a deliberately broken
upload reports every error across all three files in one response with
nothing written, and re-uploading the clean set twice leaves row counts
unchanged (idempotent upsert).

## Deployment

**Database (Neon):**

1. Create a Neon project and database.
2. Copy the **pooled** connection string from the Neon dashboard (Connection
   Details → pooled connection).
3. That string is your production `DATABASE_URL`.
4. Run the migration against it once, before traffic depends on the schema
   existing: `DATABASE_URL=<neon-pooled-url> NODE_ENV=production npm run migration:run`
   (from your local machine, or a one-off Render shell after the first deploy).

**Backend (Render):**

1. Push this repo to GitHub, then connect it in Render as a new Blueprint —
   Render picks up `render.yaml` automatically (`runtime: docker`, health
   check at `/api/health`).
2. `render.yaml` marks `DATABASE_URL` and `CORS_ORIGIN` as `sync: false`,
   meaning Render won't set them for you — add them manually in the
   service's Environment tab:
   - `DATABASE_URL` — the Neon pooled connection string from above
   - `CORS_ORIGIN` — the deployed frontend's URL (its Vercel URL), once it
     exists. Comma-separate multiple origins if needed.
3. `NODE_ENV=production` and `PORT=4000` are already set as plain values in
   `render.yaml`.
4. Render builds the Dockerfile (multi-stage, `node:22-alpine`) and deploys.
   Migrations are not run automatically on deploy — see step 4 above.

Why Render instead of Vercel: Vercel's hosting model is built around
short-lived serverless functions, which fights a NestJS app that wants a
long-lived process and a persistent TypeORM connection pool. Render runs the
Docker image as a normal long-running service, which is what this app
expects.

## Design decisions & trade-offs

- **Validation runs entirely before any write.** `ValidationService` parses
  and validates all three files (including cross-file references and
  whole-graph cycle/over-100% checks against the *merged* graph — this
  upload's edges layered onto whatever's already persisted) and returns a
  complete error list. `RegistryService.processUpload` only opens a DB
  transaction if that list is empty, so "reject the whole batch atomically"
  falls out of the control flow rather than needing a savepoint/rollback
  dance.
- **Ownership references (`ownership.csv`, `filings.csv`) must resolve
  within the *same upload's* `entities.csv`**, not against whatever's
  already in the database. Every upload is treated as a complete, internally
  consistent snapshot of the entities it touches — simpler to reason about
  and validate than allowing a filings-only or ownership-only upload against
  prior state. Documented as an explicit interpretive choice in
  `entity-registry-open-questions.md`.
- **Cycle/over-100% detection considers persisted history, not just the
  current upload.** A re-upload only carries the edges it's changing; an old
  edge from a previous upload that this batch doesn't touch is still part of
  the graph. `graph-validator.ts` merges this upload's edges onto the
  existing persisted set (by `(parent, child)` key, upsert semantics) before
  running DFS cycle detection and the per-child percentage sum — otherwise a
  cycle spanning uploads would slip through.
- **Compliance status and next-due-date are computed at read time**, in
  `compliance.util.ts`, a small pure function taking `entityStatus`,
  `nextDueDate`, and `today` — not stored, since they're a function of the
  current date and would go stale. `RegistryService` computes them
  independently for every row (top-level, subsidiary, and FQ alike), per
  the brief's "per registration" wording.
- **The list page shows one level of expansion**, not full recursive
  nesting — a subsidiary's own subsidiaries exist in the data (and are
  fully validated) but aren't shown nested under it yet. See
  `entity-registry-open-questions.md` Q2/Q3 for the reasoning and what a
  fuller implementation would need.
- **`synchronize` is off everywhere.** The migration has CHECK constraints
  and a partial unique index that TypeORM's decorator-driven sync can't
  faithfully reproduce, so the migration is the single source of truth for
  schema instead of two systems that could drift apart.

## What wasn't built and why

See `entity-registry-open-questions.md` for the full list of scope
boundaries (each traceable back to a specific open question from the
requirements analysis) — highlights:

- **Multi-level nested expansion** on the list page (grandchildren under a
  subsidiary's own row). Data model supports arbitrary depth; the UI
  doesn't render past one level yet.
- **No jurisdiction cross-check** between `filings.csv` and the matching
  entity's registered jurisdiction — treated as an independent field.
- **No canonical jurisdiction list** — format-only validation
  (`Country` or `Country/State`), any text accepted on each side.
- **No auth, no concurrency handling beyond DB transactions** — single-
  operator demo tool.
- **No upload-history/audit-log table** — natural-key upsert covers
  idempotency without one.
