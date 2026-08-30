import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  EntityRecord,
  EntityTypeValue,
  EntityStatusValue,
  GlobalRegion,
} from './entities/entity.entity';
import { OwnershipEdge } from './entities/ownership-edge.entity';
import { Filing, FilingType, FilingStatus } from './entities/filing.entity';
import {
  ValidationService,
  UploadFiles,
} from './validation/validation.service';
import {
  computeComplianceStatus,
  computeNextDueDate,
} from './compliance/compliance.util';
import { normalizeName, toDateOnlyString } from './validation/common';
import { EntitiesQueryDto } from './dto/entities-query.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { groupBy } from './util/group-by';
import { chunk } from './util/chunk';
import { escapeLikePattern } from './util/sql-like';

export interface ListChild {
  id: string;
  entityName: string;
  registrationType: 'Entity' | 'FQ';
  relation: 'subsidiary' | 'fq';
  jurisdiction: string;
  entityType: string;
  entityStatus: string;
  complianceStatus: string;
  nextDueDate: string | null;
  ownershipPct: number | null;
  subsidiaryCount: number;
  fqCount: number;
  /** Subsidiaries can themselves have subsidiaries and FQs — expansion is
   * recursive to arbitrary depth (the graph is guaranteed acyclic by
   * validation, so this always terminates). FQs are terminal: always []. */
  children: ListChild[];
  /** Whether this row's own entityName contains the active `search` term
   * (case-insensitive substring) — false when no search is active. */
  matchesSearch: boolean;
}

export interface EntitySuggestion {
  id: string;
  entityName: string;
  registrationType: 'Entity' | 'FQ';
  jurisdiction: string;
  entityType: string;
}

/** One flat row of a top-level entity's subtree — itself plus every
 * subsidiary and FQ reachable beneath it, at any depth — as returned by the
 * recursive CTE in `SUBTREE_CTE`. `viaParentId` is the id of the node this
 * row was reached from (null for the root's own "self" row). Batching
 * several root ids into one query keeps rows for each root's subtree tagged
 * by `rootId`, so one round trip can serve a whole page of top-level rows. */
interface SubtreeRow {
  id: string;
  rootId: string;
  entityName: string;
  registrationType: 'Entity' | 'FQ';
  jurisdiction: string;
  entityType: string;
  entityStatus: string;
  viaParentId: string | null;
  ownershipPct: string | null;
  relation: 'self' | 'subsidiary' | 'fq';
}

/** Walks down from a set of root entity ids via `child_links` — a
 * non-recursive union of ownership_edges (-> subsidiaries) and
 * domestic_entity_id (-> FQs), so the recursive term below only needs a
 * single self-join against `subtree` (Postgres allows a recursive CTE's
 * self-reference to appear at most once, so the two child relations can't
 * each join `subtree` directly in the same recursive term). FQs are
 * terminal — they never appear as a `parent_id` in `child_links` — so
 * recursion into an FQ self-terminates on the next iteration without an
 * explicit guard. Cycles are rejected at upload-validation time, so this
 * always terminates. */
const SUBTREE_CTE = `
  WITH RECURSIVE child_links AS (
    SELECT parent_entity_id AS parent_id, child_entity_id AS child_id,
           ownership_pct, 'subsidiary' AS relation
    FROM ownership_edges

    UNION ALL

    SELECT domestic_entity_id AS parent_id, id AS child_id,
           NULL::numeric AS ownership_pct, 'fq' AS relation
    FROM entities
    WHERE registration_type = 'FQ' AND domestic_entity_id IS NOT NULL
  ),
  subtree AS (
    SELECT
      e.id, e.id AS root_id, e.entity_name, e.registration_type,
      e.jurisdiction, e.entity_type, e.entity_status,
      NULL::uuid AS via_parent_id, NULL::numeric AS ownership_pct,
      'self' AS relation
    FROM entities e
    WHERE e.id = ANY($1::uuid[])

    UNION ALL

    SELECT
      c.id, s.root_id, c.entity_name, c.registration_type,
      c.jurisdiction, c.entity_type, c.entity_status,
      cl.parent_id, cl.ownership_pct, cl.relation
    FROM subtree s
    JOIN child_links cl ON cl.parent_id = s.id
    JOIN entities c ON c.id = cl.child_id
  )
`;

interface CandidateRoot {
  id: string;
  entityName: string;
  jurisdiction: string;
  entityType: string;
  entityStatus: string;
}

@Injectable()
export class RegistryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly validationService: ValidationService,
    private readonly configService: ConfigService,
    @InjectRepository(EntityRecord)
    private readonly entityRepo: Repository<EntityRecord>,
    @InjectRepository(OwnershipEdge)
    private readonly edgeRepo: Repository<OwnershipEdge>,
    @InjectRepository(Filing) private readonly filingRepo: Repository<Filing>,
  ) {}

  /** getAnalytics's two full-table reads (entities, edges), cached across
   * requests — this data only changes via processUpload, which clears the
   * cache on a successful write, so a request-scoped fetch would be strictly
   * redundant, not more correct. Filings are still queried fresh and scoped
   * to the entities in play, since that table is the largest and grows
   * fastest of the three. */
  private analyticsBaseCache: {
    entities: EntityRecord[];
    edges: OwnershipEdge[];
  } | null = null;

  /** Called after any out-of-band write to entities/ownership_edges (i.e.
   * not through processUpload, which already clears this itself) — used by
   * UploadAsyncController once a /upload/async job's write commits, whether
   * via the QStash callback or the local-fallback worker thread. */
  invalidateAnalyticsCache() {
    this.analyticsBaseCache = null;
  }

  private async getAnalyticsBase() {
    if (!this.analyticsBaseCache) {
      const [entities, edges] = await Promise.all([
        this.entityRepo.find(),
        this.edgeRepo.find(),
      ]);
      this.analyticsBaseCache = { entities, edges };
    }
    return this.analyticsBaseCache;
  }

  async processUpload(files: UploadFiles) {
    const { errors, entityRows, ownershipRows, filingRows } =
      await this.validationService.validateUpload(files);

    if (errors.length > 0) {
      throw new UnprocessableEntityException({ errors });
    }

    const chunkSize = this.configService.get<number>(
      'limits.uploadBatchChunkSize',
    )!;

    const result = await this.dataSource.transaction(async (manager) => {
      const entityRepo = manager.getRepository(EntityRecord);
      const edgeRepo = manager.getRepository(OwnershipEdge);
      const filingRepo = manager.getRepository(Filing);

      // Pass 1: upsert every entities.csv row by natural key (entity_name),
      // without domestic_entity_id — the entity it points at might not have
      // an id yet if it appears later in the same file. Batched into a
      // handful of multi-row upserts instead of one query per row.
      for (const batch of chunk(entityRows, chunkSize)) {
        await entityRepo.upsert(
          batch.map((row) => ({
            entityName: row.entityName,
            entityNameKey: normalizeName(row.entityName),
            registrationType: row.registrationType,
            jurisdiction: row.jurisdiction,
            entityType: row.entityType as EntityTypeValue,
            entityStatus: row.entityStatus as EntityStatusValue,
            statusDate: row.statusDate
              ? toDateOnlyString(row.statusDate)
              : null,
            formationDate: row.formationDate
              ? toDateOnlyString(row.formationDate)
              : null,
            businessId: row.businessId,
            globalRegion: row.globalRegion as GlobalRegion | null,
          })),
          ['entityNameKey'],
        );
      }

      // Every name any row in this batch could resolve to (entity rows
      // themselves, FQ -> domestic entity, ownership parent/child, filing
      // entity) — bounds this lookup to the batch instead of the whole
      // entities table, however large it's grown from prior uploads.
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
      const relevantEntities =
        referencedNames.size > 0
          ? await entityRepo.find({
              where: { entityNameKey: In([...referencedNames]) },
            })
          : [];
      // Keyed by normalized name — Entity Name matching is trimmed and
      // case-insensitive everywhere it's compared, including here where
      // ownership/filings rows resolve which entity they refer to.
      const idByName = new Map(
        relevantEntities.map((e) => [normalizeName(e.entityName), e.id]),
      );

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
        const values = fqUpdates
          .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::uuid)`)
          .join(', ');
        const params = fqUpdates.flatMap((u) => [u.key, u.domesticId]);
        await manager.query(
          `UPDATE entities AS e SET domestic_entity_id = v.domestic_id
           FROM (VALUES ${values}) AS v(key, domestic_id)
           WHERE e.entity_name_key = v.key`,
          params,
        );
      }

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
        await edgeRepo.upsert(batch, ['parentEntityId', 'childEntityId']);
      }

      const filingRecords = filingRows
        .map((row) => {
          const entityId = idByName.get(normalizeName(row.entityName));
          if (!entityId) return null;
          return {
            entityId,
            filingType: row.filingType as FilingType,
            jurisdiction: row.jurisdiction,
            filingAuthority: row.filingAuthority,
            dueDate: toDateOnlyString(row.dueDate),
            filedDate: row.filedDate ? toDateOnlyString(row.filedDate) : null,
            status: row.status as FilingStatus,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      for (const batch of chunk(filingRecords, chunkSize)) {
        await filingRepo.upsert(batch, ['entityId', 'filingType', 'dueDate']);
      }

      return {
        entities: entityRows.length,
        ownershipEdges: ownershipRows.length,
        filings: filingRows.length,
      };
    });

    // Only reached once the transaction has committed — a rolled-back
    // upload (thrown error) leaves the cache untouched.
    this.analyticsBaseCache = null;

    return result;
  }

  /** Top-level entities (own fields only) satisfying the top-level-only
   * filters (`jurisdiction`, `entityStatus`) — a plain indexed WHERE, no
   * subtree walk needed since neither filter looks at descendants. `search`
   * and `complianceStatus` are applied afterward by `getEntitiesList`, since
   * they need subtree/filings data this query doesn't fetch. */
  private async fetchCandidateRoots(
    query: EntitiesQueryDto,
  ): Promise<CandidateRoot[]> {
    const conditions = [
      `e.registration_type = 'Entity'`,
      `NOT EXISTS (SELECT 1 FROM ownership_edges oe WHERE oe.child_entity_id = e.id)`,
    ];
    const params: unknown[] = [];
    if (query.jurisdiction) {
      params.push(query.jurisdiction);
      conditions.push(`e.jurisdiction = $${params.length}`);
    }
    if (query.entityStatus) {
      params.push(query.entityStatus);
      conditions.push(`e.entity_status = $${params.length}`);
    }
    return this.dataSource.query(
      `SELECT e.id, e.entity_name AS "entityName", e.jurisdiction,
              e.entity_type AS "entityType", e.entity_status AS "entityStatus"
       FROM entities e
       WHERE ${conditions.join(' AND ')}`,
      params,
    );
  }

  /** Of `rootIds`, the ones whose subtree — the root itself or any
   * subsidiary/FQ beneath it, at any depth — has an Entity Name containing
   * `term` (case-insensitive substring). */
  private async findRootsMatchingSearch(
    rootIds: string[],
    term: string,
  ): Promise<Set<string>> {
    if (rootIds.length === 0) return new Set();
    const rows: { rootId: string }[] = await this.dataSource.query(
      `${SUBTREE_CTE}
       SELECT DISTINCT root_id AS "rootId" FROM subtree WHERE entity_name ILIKE $2`,
      [rootIds, `%${escapeLikePattern(term)}%`],
    );
    return new Set(rows.map((r) => r.rootId));
  }

  /** Full subtree (self + every descendant, any depth) for each of
   * `rootIds` — fetched only for the page of top-level rows actually being
   * returned, not the whole ownership graph. */
  private async fetchSubtrees(rootIds: string[]): Promise<SubtreeRow[]> {
    if (rootIds.length === 0) return [];
    return this.dataSource.query(
      `${SUBTREE_CTE}
       SELECT id, root_id AS "rootId", entity_name AS "entityName",
              registration_type AS "registrationType", jurisdiction,
              entity_type AS "entityType", entity_status AS "entityStatus",
              via_parent_id AS "viaParentId", ownership_pct AS "ownershipPct",
              relation
       FROM subtree`,
      [rootIds],
    );
  }

  async getEntitiesList(query: EntitiesQueryDto) {
    const today = new Date();
    const term = query.search?.trim();
    const pageSize = query.pageSize ?? 10;

    // Cheap, indexed, top-level-only filters first — shrinks the candidate
    // set before anything that needs to look at subtrees or filings.
    let candidates = await this.fetchCandidateRoots(query);

    // `search` matches the top-level entity or any descendant at any depth;
    // a top-level row survives if any node in its subtree matches.
    if (term && candidates.length > 0) {
      const matchingIds = await this.findRootsMatchingSearch(
        candidates.map((c) => c.id),
        term,
      );
      candidates = candidates.filter((c) => matchingIds.has(c.id));
    }

    // complianceStatus is derived (entityStatus + earliest unresolved due
    // date), so it can't be a plain WHERE column — only the top-level
    // entity's own filings are relevant (it filters the top-level entity's
    // own field, not its children's), so this is scoped to `candidates`,
    // never the whole filings table.
    if (query.complianceStatus && candidates.length > 0) {
      const filings = await this.filingRepo.find({
        where: { entityId: In(candidates.map((c) => c.id)) },
      });
      const filingsByEntityId = groupBy(filings, (f) => f.entityId);
      candidates = candidates.filter((c) => {
        const entityFilings = (filingsByEntityId.get(c.id) ?? []).map((f) => ({
          dueDate: new Date(`${f.dueDate}T00:00:00Z`),
          status: f.status,
        }));
        const status = computeComplianceStatus(
          c.entityStatus,
          computeNextDueDate(entityFilings),
          today,
        );
        return status === query.complianceStatus;
      });
    }

    candidates.sort((a, b) => a.entityName.localeCompare(b.entityName));

    const total = candidates.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(query.page ?? 1, 1), totalPages);
    const start = (page - 1) * pageSize;
    const pageRoots = candidates.slice(start, start + pageSize);

    if (pageRoots.length === 0) {
      return { data: [], page, pageSize, total, totalPages };
    }

    // Only now — for the ~10-100 rows actually being rendered — fetch the
    // full subtree and filings needed to build nested children and compute
    // compliance status for every node in it.
    const subtreeRows = await this.fetchSubtrees(pageRoots.map((r) => r.id));
    const filings = await this.filingRepo.find({
      where: { entityId: In(subtreeRows.map((r) => r.id)) },
    });
    const filingsByEntityId = groupBy(filings, (f) => f.entityId);
    const childrenByParent = groupBy(
      subtreeRows.filter((r) => r.relation !== 'self'),
      (r) => r.viaParentId as string,
    );

    const matchesSearch = (name: string) =>
      !!term && name.toLowerCase().includes(term.toLowerCase());

    const statusFor = (row: { id: string; entityStatus: string }) => {
      const entityFilings = (filingsByEntityId.get(row.id) ?? []).map((f) => ({
        dueDate: new Date(`${f.dueDate}T00:00:00Z`),
        status: f.status,
      }));
      const nextDueDate = computeNextDueDate(entityFilings);
      return {
        complianceStatus: computeComplianceStatus(
          row.entityStatus,
          nextDueDate,
          today,
        ),
        nextDueDate: nextDueDate ? toDateOnlyString(nextDueDate) : null,
      };
    };

    // Recursive: a subsidiary can itself have subsidiaries and FQs, expanded
    // by expanding its own row in turn, to arbitrary depth. A child with
    // more than one parent on this page appears once per parent (tagged by
    // `viaParentId`), never deduplicated to one "primary" owner.
    const buildChildren = (parentId: string): ListChild[] => {
      const direct = childrenByParent.get(parentId) ?? [];

      const fqs: ListChild[] = direct
        .filter((r) => r.relation === 'fq')
        .map((r) => {
          const { complianceStatus, nextDueDate } = statusFor(r);
          return {
            id: r.id,
            entityName: r.entityName,
            registrationType: 'FQ',
            relation: 'fq',
            jurisdiction: r.jurisdiction,
            entityType: r.entityType,
            entityStatus: r.entityStatus,
            complianceStatus,
            nextDueDate,
            ownershipPct: null,
            subsidiaryCount: 0,
            fqCount: 0,
            children: [],
            matchesSearch: matchesSearch(r.entityName),
          };
        });

      const subsidiaries: ListChild[] = direct
        .filter((r) => r.relation === 'subsidiary')
        .map((r) => {
          const { complianceStatus, nextDueDate } = statusFor(r);
          const grandchildren = childrenByParent.get(r.id) ?? [];
          return {
            id: r.id,
            entityName: r.entityName,
            registrationType: 'Entity' as const,
            relation: 'subsidiary' as const,
            jurisdiction: r.jurisdiction,
            entityType: r.entityType,
            entityStatus: r.entityStatus,
            complianceStatus,
            nextDueDate,
            ownershipPct:
              r.ownershipPct === null ? null : Number(r.ownershipPct),
            subsidiaryCount: grandchildren.filter(
              (g) => g.relation === 'subsidiary',
            ).length,
            fqCount: grandchildren.filter((g) => g.relation === 'fq').length,
            children: buildChildren(r.id),
            matchesSearch: matchesSearch(r.entityName),
          };
        });

      return [...fqs, ...subsidiaries];
    };

    const data = pageRoots.map((root) => {
      const { complianceStatus, nextDueDate } = statusFor(root);
      const direct = childrenByParent.get(root.id) ?? [];
      return {
        id: root.id,
        entityName: root.entityName,
        registrationType: 'Entity' as const,
        jurisdiction: root.jurisdiction,
        entityType: root.entityType,
        entityStatus: root.entityStatus,
        complianceStatus,
        nextDueDate,
        subsidiaryCount: direct.filter((r) => r.relation === 'subsidiary')
          .length,
        fqCount: direct.filter((r) => r.relation === 'fq').length,
        children: buildChildren(root.id),
        matchesSearch: matchesSearch(root.entityName),
      };
    });

    return { data, page, pageSize, total, totalPages };
  }

  /** Name suggestions for the search bar's autocomplete dropdown — every
   * entity at any level (top-level, subsidiary, or FQ) is a candidate,
   * matched by a case-insensitive substring and ranked by how early the
   * term appears, then by name length, then alphabetically. Runs entirely
   * in Postgres (ILIKE against a trigram-indexed column) instead of loading
   * every entity into the app to score. Clicking a suggestion is meant to
   * hand its exact `entityName` back to `search`, so this deliberately
   * returns the canonical name rather than anything about *why* it matched. */
  async getEntitySuggestions(
    q: string,
    limit: number,
  ): Promise<{ suggestions: EntitySuggestion[] }> {
    const term = q.trim();
    if (!term) return { suggestions: [] };

    const suggestions: EntitySuggestion[] = await this.dataSource.query(
      `SELECT id, entity_name AS "entityName",
              registration_type AS "registrationType",
              jurisdiction, entity_type AS "entityType"
       FROM entities
       WHERE entity_name ILIKE $1
       ORDER BY POSITION(LOWER($2) IN LOWER(entity_name)), LENGTH(entity_name), entity_name
       LIMIT $3`,
      [`%${escapeLikePattern(term)}%`, term, limit],
    );

    return { suggestions };
  }

  /** Distinct jurisdictions across every entity (any registration type or
   * depth) — backs the list page's jurisdiction filter dropdown, which needs
   * the full option set independent of pagination. */
  async getJurisdictions(): Promise<{ jurisdictions: string[] }> {
    const rows: { jurisdiction: string }[] = await this.entityRepo
      .createQueryBuilder('e')
      .select('DISTINCT e.jurisdiction', 'jurisdiction')
      .orderBy('e.jurisdiction', 'ASC')
      .getRawMany();
    return { jurisdictions: rows.map((r) => r.jurisdiction) };
  }

  async getAnalytics(query: AnalyticsQueryDto) {
    const today = new Date();
    const { entities, edges } = await this.getAnalyticsBase();

    const entityById = new Map(entities.map((e) => [e.id, e]));
    let filteredEntities = entities;
    if (query.jurisdiction)
      filteredEntities = filteredEntities.filter(
        (e) => e.jurisdiction === query.jurisdiction,
      );
    if (query.entityStatus)
      filteredEntities = filteredEntities.filter(
        (e) => e.entityStatus === query.entityStatus,
      );

    // Only the compliance breakdown (a) needs filings, and only for
    // filteredEntities — scoping this avoids loading the whole filings
    // table (typically the largest and fastest-growing of the three) on
    // every analytics request, especially once jurisdiction/entityStatus
    // narrow the entity set down.
    const filings =
      filteredEntities.length > 0
        ? await this.filingRepo.find({
            where: { entityId: In(filteredEntities.map((e) => e.id)) },
          })
        : [];

    const filingsByEntityId = groupBy(filings, (f) => f.entityId);
    const complianceStatusFor = (entity: EntityRecord) => {
      const entityFilings = (filingsByEntityId.get(entity.id) ?? []).map(
        (f) => ({
          dueDate: new Date(`${f.dueDate}T00:00:00Z`),
          status: f.status,
        }),
      );
      return computeComplianceStatus(
        entity.entityStatus,
        computeNextDueDate(entityFilings),
        today,
      );
    };

    // (a) compliance status breakdown — every entities.csv row, independently.
    const breakdownCounts = new Map<string, number>();
    for (const entity of filteredEntities) {
      const status = complianceStatusFor(entity);
      breakdownCounts.set(status, (breakdownCounts.get(status) ?? 0) + 1);
    }
    const complianceBreakdown = [...breakdownCounts.entries()].map(
      ([status, count]) => ({ status, count }),
    );

    // (b) entity status by region — no-region buckets into 'Unspecified'.
    const regionCounts = new Map<string, number>();
    for (const entity of filteredEntities) {
      const region = entity.globalRegion ?? 'Unspecified';
      const key = `${region}|||${entity.entityStatus}`;
      regionCounts.set(key, (regionCounts.get(key) ?? 0) + 1);
    }
    const entityStatusByRegion = [...regionCounts.entries()].map(
      ([key, count]) => {
        const [region, entityStatus] = key.split('|||');
        return { region, entityStatus, count };
      },
    );

    // (c) subsidiary vs FQ count per top-level entity — the full descendant
    // set reachable anywhere in the tree, deduplicated by entity (a child
    // reached via two different ownership paths counts once, not twice).
    const childEntityIds = new Set(edges.map((e) => e.childEntityId));
    const edgesByParent = groupBy(edges, (e) => e.parentEntityId);
    const fqsByDomesticId = groupBy(
      entities.filter((e) => e.registrationType === 'FQ' && e.domesticEntityId),
      (e) => e.domesticEntityId as string,
    );
    const topLevel = filteredEntities.filter(
      (e) => e.registrationType === 'Entity' && !childEntityIds.has(e.id),
    );
    const collectDescendants = (rootId: string) => {
      const subsidiaryIds = new Set<string>();
      const fqIds = new Set<string>();
      const stack = [rootId];
      while (stack.length > 0) {
        const current = stack.pop()!;
        for (const fq of fqsByDomesticId.get(current) ?? []) {
          fqIds.add(fq.id);
        }
        for (const edge of edgesByParent.get(current) ?? []) {
          if (!subsidiaryIds.has(edge.childEntityId)) {
            subsidiaryIds.add(edge.childEntityId);
            stack.push(edge.childEntityId);
          }
        }
      }
      return { subsidiaryIds, fqIds };
    };
    const subsidiaryFqCountByTopLevel = topLevel.map((entity) => {
      const { subsidiaryIds, fqIds } = collectDescendants(entity.id);
      return {
        entityName: entity.entityName,
        subsidiaries: subsidiaryIds.size,
        fqs: fqIds.size,
      };
    });

    // (d) ownership % across a selected parent's children, with unallocated
    // remainder. Selecting a parent picks the *set* of children to display
    // (its direct children only); for each child shown, the value plotted is
    // that child's total ownership allocated across ALL of its parents (not
    // just the selected one) — the same total the per-child ≤100%
    // validation rule tracks — versus its own unallocated remainder. Each
    // child gets its own two-segment bar since each child's total is an
    // independent number, not a shared whole to stack together.
    const parentIds = new Set(edges.map((e) => e.parentEntityId));
    const parents = filteredEntities
      .filter((e) => parentIds.has(e.id))
      .map((e) => ({ id: e.id, entityName: e.entityName }))
      .sort((a, b) => a.entityName.localeCompare(b.entityName));

    let selectedParentId = query.parentEntityId ?? null;
    if (selectedParentId && !parents.some((p) => p.id === selectedParentId)) {
      selectedParentId = null;
    }
    if (!selectedParentId && parents.length > 0) {
      selectedParentId = parents[0].id;
    }

    const totalPctByChildId = new Map<string, number>();
    for (const edge of edges) {
      totalPctByChildId.set(
        edge.childEntityId,
        (totalPctByChildId.get(edge.childEntityId) ?? 0) +
          Number(edge.ownershipPct),
      );
    }

    let children: {
      entityName: string;
      pct: number;
      unallocatedPct: number;
    }[] = [];
    if (selectedParentId) {
      const parentEdges = (edgesByParent.get(selectedParentId) ?? []).filter(
        (edge) => {
          const child = entityById.get(edge.childEntityId);
          if (!child) return false;
          if (query.jurisdiction && child.jurisdiction !== query.jurisdiction)
            return false;
          if (query.entityStatus && child.entityStatus !== query.entityStatus)
            return false;
          return true;
        },
      );
      children = parentEdges.map((edge) => {
        const totalPct =
          totalPctByChildId.get(edge.childEntityId) ??
          Number(edge.ownershipPct);
        return {
          entityName: entityById.get(edge.childEntityId)!.entityName,
          pct: totalPct,
          unallocatedPct: Math.max(0, Math.round((100 - totalPct) * 100) / 100),
        };
      });
    }

    return {
      complianceBreakdown,
      entityStatusByRegion,
      subsidiaryFqCountByTopLevel,
      ownershipByParent: {
        parents,
        selectedParentId,
        children,
      },
    };
  }
}
