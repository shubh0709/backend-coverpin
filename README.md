# CoverPin Backend

A NestJS + TypeORM + PostgreSQL API for managing compliance entities (LLCs,
corporations, partnerships, nonprofits) and the filings they owe across
jurisdictions, plus an AI endpoint that drafts a compliance checklist for a
given entity.

This was built as interview-prep scaffolding for a Senior Full Stack Engineer
role at CoverPin, an AI-native compliance automation platform. Rather than
sketch the full product surface (services catalog, orders, payments, multiple
domain modules) shallowly, this repo builds one domain module — Entities and
their nested Filings — end to end: real state machine, real input validation,
real (non-mocked) AI integration with output validation, migrations, seed
data, tests, and a documented deployment path. See "What wasn't built and
why" below for the explicit scope cuts.

The companion frontend lives in a separate sibling repo (`client-app`) and is
deployed independently — this is a deliberate two-repo split, not a monorepo.

## Tech stack

- **NestJS 11** (Express platform)
- **TypeORM 0.3.x** + **PostgreSQL** — pinned to 0.3.x on purpose, not the
  newer 1.x line (see "Design decisions" below)
- **class-validator** / **class-transformer** for both incoming DTO
  validation and outgoing AI-response validation
- **OpenAI SDK** (`openai` package) for the compliance checklist generation,
  using structured `json_schema` output
- **Swagger** (`@nestjs/swagger`) for interactive API docs
- **Jest** + **Supertest** for unit and e2e tests
- **Docker** (docker-compose for local Postgres, multi-stage Dockerfile for
  deployment)
- **Neon** (managed Postgres) + **Render** (hosting) for deployment
- **npm** as the package manager

## Local setup

Requires Node 20.19+ or Node 22+ (see note below), Docker, and an npm
registry connection.

```bash
git clone <this-repo-url>
cd coverpin-backend
npm install
cp .env.example .env
docker compose up -d
npm run migration:run
npm run seed
npm run start:dev
```

Then check:

- `http://localhost:4000/api/health` — should return a healthy status
- `http://localhost:4000/api/docs` — Swagger UI with every endpoint

Notes:

- `docker compose up -d` starts a local Postgres 16 container **mapped to
  host port 5433, not 5432** (see `docker-compose.yml`). This is deliberate —
  5432 is commonly already bound by another local Postgres instance, and a
  silent port clash is a more confusing failure mode than a nonstandard port.
  `.env.example`'s `DATABASE_URL` already points at 5433.
- `OPENAI_API_KEY` is optional for everything except the compliance-checklist
  endpoint. The rest of the API (entities, filings, health) works fine
  without it. If you want to exercise the AI endpoint, set a real key in
  `.env`.
- This repo was developed and verified on Node 20.11.1. NestJS/its
  dependencies print `engines` version warnings on that version — the app
  still runs correctly, but if you want a clean install with no warnings,
  use Node 20.19+ or 22+.

## API testing

- **Swagger UI** at `/api/docs` once the server is running — every route,
  request/response shape, and enum value is documented there.
- **Postman**: import both files in `postman/` —
  `CoverPin-Backend.postman_collection.json` (requests) and
  `CoverPin-Local.postman_environment.json` (environment, `baseUrl` defaults
  to `http://localhost:4000/api`). The collection's test scripts
  auto-capture `entityId` and `filingId` from responses into collection
  variables, so you can run requests in order (create entity → create filing
  → transition filing → ...) without manually copying IDs between requests.
  It also includes a request that deliberately attempts an invalid filing
  transition and expects a 400, to exercise the state machine's guard rails.

## Testing

```bash
npm test          # unit tests — mocked repos/OpenAI client, no DB needed
npm run test:e2e  # e2e tests — needs the docker-compose Postgres running
```

- `entities.service.spec.ts` — duplicate-entity rejection, not-found paths,
  and valid/invalid/terminal-state filing transitions, all against mocked
  TypeORM repositories.
- `ai.service.spec.ts` — mocks the `openai` package to cover: missing API
  key, a valid structured response, a response that fails schema validation
  (simulating an LLM hallucination), and a wrapped network failure.
- `app.e2e-spec.ts` / `entities.e2e-spec.ts` — real HTTP requests against a
  real NestJS app + real Postgres: invalid jurisdiction rejected, missing
  fields rejected, full create → duplicate-rejected → filing lifecycle walk
  (including a rejected skip-to-CONFIRMED and a rejected transition out of
  the terminal CONFIRMED state) → 404 on a missing entity → 400 on a
  malformed UUID.

`test/jest-e2e.json` pins `maxWorkers: 1`. This was necessary: with
`synchronize: true` in non-production (see below), running e2e suites across
multiple Jest workers caused a race where two workers tried to create the
same Postgres enum type concurrently and one failed. Running the e2e suite
single-threaded avoids it entirely, at the cost of some speed — acceptable
for a suite this size.

## Deployment

**Database (Neon):**

1. Create a Neon project and database.
2. Copy the **pooled** connection string from the Neon dashboard (Connection
   Details → pooled connection).
3. That string is your production `DATABASE_URL`.

**Backend (Render):**

1. Push this repo to GitHub, then connect it in Render as a new Blueprint —
   Render will pick up `render.yaml` automatically (`runtime: docker`,
   health check at `/api/health`).
2. `render.yaml` marks `DATABASE_URL`, `CORS_ORIGIN`, and `OPENAI_API_KEY` as
   `sync: false`, meaning Render won't set them for you — add them manually
   in the service's Environment tab in the Render dashboard:
   - `DATABASE_URL` — the Neon pooled connection string from above
   - `CORS_ORIGIN` — the deployed frontend's URL (e.g. its Vercel URL), once
     it exists. Comma-separate multiple origins if needed.
   - `OPENAI_API_KEY` — your OpenAI key, if you want the compliance-checklist
     endpoint to work in production.
3. `NODE_ENV=production`, `PORT=4000`, and `OPENAI_MODEL=gpt-4o-mini` are
   already set as plain values in `render.yaml`.
4. Render builds the Dockerfile (multi-stage, `node:22-alpine`) and deploys.
   Migrations are not run automatically on deploy — run `npm run
   migration:run` against the production `DATABASE_URL` (e.g. from your
   local machine or a one-off Render shell) after the first deploy, before
   traffic depends on the schema existing.

Why Render instead of Vercel: Vercel's hosting model is built around
short-lived serverless functions, which fights a NestJS app that wants a
long-lived process and a persistent TypeORM connection pool. Render runs the
Docker image as a normal long-running service, which is what this app
expects.

## Design decisions & trade-offs

- **Forward-only filing state machine.** `Filing.status` moves
  `PENDING -> AI_PROCESSING -> FILED -> CONFIRMED` and nothing else, enforced
  by an explicit transition map in `EntitiesService.transitionFilingStatus`
  (`AI_PROCESSING` can also fall back to `PENDING`, everything else is a hard
  wall). Any attempt to skip a stage, go backward, or act on a terminal
  filing throws a 400 with the allowed next states in the message. This is a
  small in-process state machine, not a library — appropriate at this scale,
  but see "what I'd do with more time" below on where it stops being enough.
- **AI output is not trusted.** `AiService` asks OpenAI for `json_schema`
  structured output, but still runs the parsed result through
  `class-validator` (`ComplianceChecklistResultDto`) before it's allowed
  anywhere near the database. A response that's missing a field, has the
  wrong type, or invents a `priority` value outside `LOW/MEDIUM/HIGH` is
  rejected with a 502, not silently persisted. Network failures and
  malformed JSON are caught and wrapped the same way. If `OPENAI_API_KEY` is
  unset, the failure happens lazily at call time (503), not at app startup —
  the rest of the API doesn't depend on OpenAI being configured.
- **Audit fields on the entity, not a separate table.** `lastComplianceCheck`
  (jsonb) and `lastCheckedAt` capture the most recent AI result directly on
  `ComplianceEntity`. That's enough to show "when did we last check this
  entity and what did we find" without building a full audit-log table for a
  single AI call site.
- **TypeORM pinned to 0.3.x**, not the newer 1.x. 1.x's CLI has a known
  yargs ESM/CommonJS bug that breaks `migration:generate` and
  `migration:run` outright. 0.3.x is also what essentially all current
  NestJS documentation and tutorials assume, which matters when moving fast
  under interview-style time pressure — less time fighting version-specific
  API differences.
- **Jurisdiction is a validated string code**, not a foreign key into a
  jurisdiction table (`CreateEntityDto` regex-checks the
  `COUNTRY-SUBDIVISION` shape, e.g. `US-DE`, `CA-ON`). Fine for a handful of
  jurisdictions with no jurisdiction-specific rules yet; would not scale to
  per-jurisdiction filing requirements or due-date rules.
- **Local Postgres on host port 5433.** `docker-compose.yml` maps
  `5433:5432` specifically so this doesn't collide with a Postgres instance
  someone already has running on the default port — a small thing, but the
  alternative is a confusing "port already in use" error on first run.
- **`synchronize: true` outside production, migrations in production.**
  Fast iteration locally; the one migration that exists (`InitSchema`) is
  what actually runs in a deployed environment, so schema drift between
  environments doesn't happen. The trade-off is the e2e test threading issue
  noted above.

## What wasn't built and why

This scope deliberately does not cover the full CoverPin product surface.
Specifically, out of scope:

- **Auth (Clerk).** The JD names Clerk explicitly, but it's left out here so
  the lean scaffold stays focused on the compliance domain modeling itself
  rather than auth wiring. In a real assignment with auth in scope, a Clerk
  guard/strategy would be the first thing added, ahead of any business
  logic.
- **Stripe payments and AWS S3 document storage.** Both are named in the JD
  and both matter to the real product (pay-per-service ordering, filing
  document attachments), but neither is needed by the Entities/Filings
  module as built. Would add S3 for attaching filing documents and Stripe
  for the pay-per-service ordering flow that's part of CoverPin's actual
  business model.
- **A services catalog / order-placement flow** (browse services, place an
  order, track order status). That's the "full demo product" version of
  this exercise. Deliberately scoped down to one domain module built
  properly end-to-end, instead of several modules built shallowly.
- **A jurisdiction master table.** Current approach (validated string code)
  is fine for a handful of jurisdictions; would need a real table with
  per-jurisdiction rules once that logic exists.
- **A real workflow engine (e.g. Temporal) for filings.** The in-process
  state machine works at this scale, but it doesn't survive a process
  restart mid-filing, has no retry/backoff semantics, and doesn't
  orchestrate work across services. Fine for a demo, not for production
  filing volume.
- **Multi-tenant isolation, soft deletes, rate limiting, request
  logging/observability, pagination on list endpoints.** All reasonable
  fast-follows, none built here — noted rather than silently skipped.

## What I'd do with more time

- Add pagination and filtering (by jurisdiction, status, entity type) to the
  list endpoints — they currently return everything.
- Add a jurisdiction table with per-jurisdiction filing-type rules, and use
  it to drive the AI prompt instead of relying on the model's general
  knowledge.
- Add S3-backed document attachments on filings (upload a signed filing,
  store the object key, not the file itself, in Postgres).
- Add Clerk auth with a simple ownership model (an entity belongs to an
  account), plus row-level access checks in the service layer.
- Add structured request logging and basic observability (request IDs,
  latency, error rates) — currently there's console logging via Nest's
  `Logger` and nothing more.
- Move the filing state machine into something that survives process
  restarts and supports retries/backoff for the AI-processing step, once
  filing volume or AI latency makes that necessary.
- Add rate limiting on the AI endpoint specifically — it's the one route
  that costs money per call and currently has no throttling.
