import { normalizeName, toDateOnlyString } from './validation/common';
import { chunk } from './util/chunk';
import { ParsedEntityRow } from './validation/entities-validator';
import { ParsedOwnershipRow } from './validation/ownership-validator';
import { ParsedFilingRow } from './validation/filings-validator';

/** Minimal surface both a TypeORM `EntityManager` and a raw `pg` client
 * satisfy — `EntityManager.query()` already returns rows directly (not
 * `{ rows }`), so a `pg` client is adapted to match (see
 * `pgClientAsQueryable` in upload-writer.worker.ts) rather than the other
 * way around. */
export interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

// JSON-safe row shapes for `upload_jobs.payload` (jsonb). `ValidationService`
// produces `Parsed*Row`s with real `Date` objects and a `line` number for
// error reporting; neither survives a jsonb round-trip as-is (a `Date`
// becomes a plain ISO string, and `line` is meaningless once the batch is no
// longer tied to the original files). `toUploadBatchRows` converts once, at
// job-creation time, so everything downstream only ever handles strings.
export interface UploadEntityRow {
  entityName: string;
  registrationType: 'Entity' | 'FQ';
  jurisdiction: string;
  entityType: string;
  entityStatus: string;
  statusDate: string | null;
  domesticEntity: string | null;
  formationDate: string | null;
  businessId: string | null;
  globalRegion: string | null;
}

export interface UploadOwnershipRow {
  parentEntity: string;
  childEntity: string;
  ownershipPct: number;
}

export interface UploadFilingRow {
  entityName: string;
  filingType: string;
  jurisdiction: string;
  filingAuthority: string | null;
  dueDate: string;
  filedDate: string | null;
  status: string;
}

export interface UploadBatchRows {
  entityRows: UploadEntityRow[];
  ownershipRows: UploadOwnershipRow[];
  filingRows: UploadFilingRow[];
}

export interface UploadBatchResult {
  entities: number;
  ownershipEdges: number;
  filings: number;
}

/** Shape posted back from upload-writer.worker.ts to the thread that spawned
 * it, and reused by QueueDispatchService as its own return type for the
 * local-fallback path — one outcome shape for both. */
export type UploadBatchOutcome =
  { ok: true; result: UploadBatchResult } | { ok: false; error: string };

/** Converts `ValidationService.validateUpload`'s output (real `Date`s, error-
 * reporting `line` numbers) into the JSON-safe shape stored in
 * `upload_jobs.payload`. Call this once, right after validation succeeds. */
export function toUploadBatchRows(rows: {
  entityRows: ParsedEntityRow[];
  ownershipRows: ParsedOwnershipRow[];
  filingRows: ParsedFilingRow[];
}): UploadBatchRows {
  return {
    entityRows: rows.entityRows.map((row) => ({
      entityName: row.entityName,
      registrationType: row.registrationType,
      jurisdiction: row.jurisdiction,
      entityType: row.entityType,
      entityStatus: row.entityStatus,
      statusDate: row.statusDate ? toDateOnlyString(row.statusDate) : null,
      domesticEntity: row.domesticEntity,
      formationDate: row.formationDate
        ? toDateOnlyString(row.formationDate)
        : null,
      businessId: row.businessId,
      globalRegion: row.globalRegion,
    })),
    ownershipRows: rows.ownershipRows.map((row) => ({
      parentEntity: row.parentEntity,
      childEntity: row.childEntity,
      ownershipPct: row.ownershipPct,
    })),
    filingRows: rows.filingRows.map((row) => ({
      entityName: row.entityName,
      filingType: row.filingType,
      jurisdiction: row.jurisdiction,
      filingAuthority: row.filingAuthority,
      dueDate: toDateOnlyString(row.dueDate),
      filedDate: row.filedDate ? toDateOnlyString(row.filedDate) : null,
      status: row.status,
    })),
  };
}

const valuesTuple = (cols: string[], base: number) =>
  `(${cols.map((_, c) => `$${base + c + 1}`).join(', ')})`;

/**
 * Raw-SQL twin of `RegistryService.processUpload`'s transaction body (same
 * repo, `registry.service.ts`) — same 4 passes, same natural-key upsert
 * semantics, same FQ-backfill-after-ids-resolved ordering. It exists
 * separately, as plain parameterized SQL against the minimal `Queryable`
 * interface above, so it can run identically from either:
 *  - the QStash-callback route, via `dataSource.transaction(manager => ...)`
 *    (main thread, TypeORM `EntityManager`), or
 *  - the local-fallback path, inside `upload-writer.worker.ts`
 *    (`worker_threads` can't share the main thread's TypeORM `DataSource`,
 *    so that path uses a plain `pg` client instead).
 *
 * This is a deliberate duplication of `RegistryService.processUpload`'s
 * write logic, not a refactor of it — `/upload` stays untouched. If the
 * `entities`/`ownership_edges`/`filings` schema changes, update both.
 */
export async function writeUploadBatch(
  rows: UploadBatchRows,
  db: Queryable,
  chunkSize: number,
): Promise<UploadBatchResult> {
  const { entityRows, ownershipRows, filingRows } = rows;

  // Pass 1: upsert every entities.csv row by natural key (entity_name_key),
  // without domestic_entity_id -- the entity it points at might not have an
  // id yet if it appears later in the same batch.
  const entityCols = [
    'entity_name',
    'entity_name_key',
    'registration_type',
    'jurisdiction',
    'entity_type',
    'entity_status',
    'status_date',
    'formation_date',
    'business_id',
    'global_region',
  ];
  for (const batch of chunk(entityRows, chunkSize)) {
    const values: unknown[] = [];
    const tuples = batch.map((row, i) => {
      values.push(
        row.entityName,
        normalizeName(row.entityName),
        row.registrationType,
        row.jurisdiction,
        row.entityType,
        row.entityStatus,
        row.statusDate,
        row.formationDate,
        row.businessId,
        row.globalRegion,
      );
      return valuesTuple(entityCols, i * entityCols.length);
    });
    await db.query(
      `INSERT INTO entities (${entityCols.join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT (entity_name_key) DO UPDATE SET
         entity_name = EXCLUDED.entity_name,
         registration_type = EXCLUDED.registration_type,
         jurisdiction = EXCLUDED.jurisdiction,
         entity_type = EXCLUDED.entity_type,
         entity_status = EXCLUDED.entity_status,
         status_date = EXCLUDED.status_date,
         formation_date = EXCLUDED.formation_date,
         business_id = EXCLUDED.business_id,
         global_region = EXCLUDED.global_region,
         updated_at = now()`,
      values,
    );
  }

  // Every name any row in this batch could resolve to -- bounds the lookup
  // below to the batch instead of the whole entities table.
  const referencedNames = new Set<string>();
  for (const row of entityRows) {
    referencedNames.add(normalizeName(row.entityName));
    if (row.domesticEntity) {
      referencedNames.add(normalizeName(row.domesticEntity));
    }
  }
  for (const row of ownershipRows) {
    referencedNames.add(normalizeName(row.parentEntity));
    referencedNames.add(normalizeName(row.childEntity));
  }
  for (const row of filingRows) {
    referencedNames.add(normalizeName(row.entityName));
  }
  const idByName = new Map<string, string>();
  if (referencedNames.size > 0) {
    const relevant = await db.query<{ id: string; entity_name_key: string }>(
      `SELECT id, entity_name_key FROM entities WHERE entity_name_key = ANY($1::text[])`,
      [[...referencedNames]],
    );
    for (const r of relevant) idByName.set(r.entity_name_key, r.id);
  }

  // Pass 2: now that every row in this batch has an id, wire up FQ ->
  // domestic entity in one statement instead of one UPDATE per FQ row.
  const fqUpdates = entityRows
    .filter((row) => row.registrationType === 'FQ')
    .map((row) => ({
      key: normalizeName(row.entityName),
      domesticId: row.domesticEntity
        ? (idByName.get(normalizeName(row.domesticEntity)) ?? null)
        : null,
    }));
  if (fqUpdates.length > 0) {
    const valuesClause = fqUpdates
      .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::uuid)`)
      .join(', ');
    const params = fqUpdates.flatMap((u) => [u.key, u.domesticId]);
    await db.query(
      `UPDATE entities AS e SET domestic_entity_id = v.domestic_id
       FROM (VALUES ${valuesClause}) AS v(key, domestic_id)
       WHERE e.entity_name_key = v.key`,
      params,
    );
  }

  // Pass 3: ownership edges, upserted by (parent, child).
  const edgeCols = ['parent_entity_id', 'child_entity_id', 'ownership_pct'];
  const edgeRecords = ownershipRows
    .map((row) => {
      const parentEntityId = idByName.get(normalizeName(row.parentEntity));
      const childEntityId = idByName.get(normalizeName(row.childEntity));
      if (!parentEntityId || !childEntityId) return null;
      return {
        parentEntityId,
        childEntityId,
        ownershipPct: row.ownershipPct.toFixed(2),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  for (const batch of chunk(edgeRecords, chunkSize)) {
    const values: unknown[] = [];
    const tuples = batch.map((row, i) => {
      values.push(row.parentEntityId, row.childEntityId, row.ownershipPct);
      return valuesTuple(edgeCols, i * edgeCols.length);
    });
    await db.query(
      `INSERT INTO ownership_edges (${edgeCols.join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT (parent_entity_id, child_entity_id) DO UPDATE SET
         ownership_pct = EXCLUDED.ownership_pct,
         updated_at = now()`,
      values,
    );
  }

  // Pass 4: filings, upserted by (entity, filing type, due date).
  const filingCols = [
    'entity_id',
    'filing_type',
    'jurisdiction',
    'filing_authority',
    'due_date',
    'filed_date',
    'status',
  ];
  const filingRecords = filingRows
    .map((row) => {
      const entityId = idByName.get(normalizeName(row.entityName));
      if (!entityId) return null;
      return {
        entityId,
        filingType: row.filingType,
        jurisdiction: row.jurisdiction,
        filingAuthority: row.filingAuthority,
        dueDate: row.dueDate,
        filedDate: row.filedDate,
        status: row.status,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  for (const batch of chunk(filingRecords, chunkSize)) {
    const values: unknown[] = [];
    const tuples = batch.map((row, i) => {
      values.push(
        row.entityId,
        row.filingType,
        row.jurisdiction,
        row.filingAuthority,
        row.dueDate,
        row.filedDate,
        row.status,
      );
      return valuesTuple(filingCols, i * filingCols.length);
    });
    await db.query(
      `INSERT INTO filings (${filingCols.join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT (entity_id, filing_type, due_date) DO UPDATE SET
         jurisdiction = EXCLUDED.jurisdiction,
         filing_authority = EXCLUDED.filing_authority,
         filed_date = EXCLUDED.filed_date,
         status = EXCLUDED.status,
         updated_at = now()`,
      values,
    );
  }

  return {
    entities: entityRows.length,
    ownershipEdges: ownershipRows.length,
    filings: filingRows.length,
  };
}
