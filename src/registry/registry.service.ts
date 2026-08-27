import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
  /** Whether this row's own entityName matched the active `search` term. */
  matchesSearch: boolean;
}

@Injectable()
export class RegistryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly validationService: ValidationService,
    @InjectRepository(EntityRecord)
    private readonly entityRepo: Repository<EntityRecord>,
    @InjectRepository(OwnershipEdge)
    private readonly edgeRepo: Repository<OwnershipEdge>,
    @InjectRepository(Filing) private readonly filingRepo: Repository<Filing>,
  ) {}

  async processUpload(files: UploadFiles) {
    const { errors, entityRows, ownershipRows, filingRows } =
      await this.validationService.validateUpload(files);

    if (errors.length > 0) {
      throw new UnprocessableEntityException({ errors });
    }

    return this.dataSource.transaction(async (manager) => {
      const entityRepo = manager.getRepository(EntityRecord);
      const edgeRepo = manager.getRepository(OwnershipEdge);
      const filingRepo = manager.getRepository(Filing);

      // Pass 1: upsert every entities.csv row by natural key (entity_name),
      // without domestic_entity_id — the entity it points at might not have
      // an id yet if it appears later in the same file.
      for (const row of entityRows) {
        await entityRepo.upsert(
          {
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
          },
          ['entityNameKey'],
        );
      }

      const allEntities = await entityRepo.find();
      // Keyed by normalized name — Entity Name matching is trimmed and
      // case-insensitive everywhere it's compared, including here where
      // ownership/filings rows resolve which entity they refer to.
      const idByName = new Map(
        allEntities.map((e) => [normalizeName(e.entityName), e.id]),
      );

      // Pass 2: now that every row in this batch has an id, wire up FQ -> domestic entity.
      for (const row of entityRows) {
        if (row.registrationType === 'FQ') {
          await entityRepo.update(
            { entityNameKey: normalizeName(row.entityName) },
            {
              domesticEntityId: row.domesticEntity
                ? (idByName.get(normalizeName(row.domesticEntity)) ?? null)
                : null,
            },
          );
        }
      }

      for (const row of ownershipRows) {
        const parentEntityId = idByName.get(normalizeName(row.parentEntity));
        const childEntityId = idByName.get(normalizeName(row.childEntity));
        if (!parentEntityId || !childEntityId) continue;
        await edgeRepo.upsert(
          {
            parentEntityId,
            childEntityId,
            ownershipPct: row.ownershipPct.toFixed(2),
          },
          ['parentEntityId', 'childEntityId'],
        );
      }

      for (const row of filingRows) {
        const entityId = idByName.get(normalizeName(row.entityName));
        if (!entityId) continue;
        await filingRepo.upsert(
          {
            entityId,
            filingType: row.filingType as FilingType,
            jurisdiction: row.jurisdiction,
            filingAuthority: row.filingAuthority,
            dueDate: toDateOnlyString(row.dueDate),
            filedDate: row.filedDate ? toDateOnlyString(row.filedDate) : null,
            status: row.status as FilingStatus,
          },
          ['entityId', 'filingType', 'dueDate'],
        );
      }

      return {
        entities: entityRows.length,
        ownershipEdges: ownershipRows.length,
        filings: filingRows.length,
      };
    });
  }

  async getEntitiesList(query: EntitiesQueryDto) {
    const today = new Date();

    // The search term is matched directly in the database (case-insensitive
    // substring on entity_name), not against the in-memory tree — this runs
    // as a real SQL query against Postgres. It intentionally matches at
    // every level (top-level entity, subsidiary, or FQ); `matchedIds` below
    // is then used both to decide which top-level branches survive
    // filtering and to flag exactly which node(s) matched so the client can
    // auto-expand the path down to them.
    const term = query.search?.trim();
    let matchedIds: Set<string> | null = null;
    if (term) {
      const matches: { id: string }[] = await this.entityRepo
        .createQueryBuilder('e')
        .select('e.id', 'id')
        .where('e.entity_name ILIKE :term', { term: `%${term}%` })
        .getRawMany();
      matchedIds = new Set(matches.map((m) => m.id));
    }

    const [entities, edges, filings] = await Promise.all([
      this.entityRepo.find(),
      this.edgeRepo.find(),
      this.filingRepo.find(),
    ]);

    const entityById = new Map(entities.map((e) => [e.id, e]));
    const filingsByEntityId = groupBy(filings, (f) => f.entityId);
    const childEntityIds = new Set(edges.map((e) => e.childEntityId));
    const edgesByParent = groupBy(edges, (e) => e.parentEntityId);
    const fqsByDomesticId = groupBy(
      entities.filter((e) => e.registrationType === 'FQ' && e.domesticEntityId),
      (e) => e.domesticEntityId as string,
    );

    const statusFor = (entity: EntityRecord) => {
      const entityFilings = (filingsByEntityId.get(entity.id) ?? []).map(
        (f) => ({
          dueDate: new Date(`${f.dueDate}T00:00:00Z`),
          status: f.status,
        }),
      );
      const nextDueDate = computeNextDueDate(entityFilings);
      return {
        complianceStatus: computeComplianceStatus(
          entity.entityStatus,
          nextDueDate,
          today,
        ),
        nextDueDate: nextDueDate ? toDateOnlyString(nextDueDate) : null,
      };
    };

    const topLevel = entities.filter(
      (e) => e.registrationType === 'Entity' && !childEntityIds.has(e.id),
    );

    // Recursive: a subsidiary can itself have subsidiaries and FQs, expanded
    // by expanding its own row in turn, to arbitrary depth. Cycles are
    // rejected at validation time, so the graph is guaranteed acyclic and
    // this always terminates. A child with more than one parent is walked
    // — and appears — once per parent, never deduplicated to one "primary"
    // owner.
    const buildChildren = (parentId: string): ListChild[] => {
      const fqs: ListChild[] = (fqsByDomesticId.get(parentId) ?? []).map(
        (fq) => {
          const fqStatus = statusFor(fq);
          return {
            id: fq.id,
            entityName: fq.entityName,
            registrationType: 'FQ',
            relation: 'fq',
            jurisdiction: fq.jurisdiction,
            entityType: fq.entityType,
            entityStatus: fq.entityStatus,
            complianceStatus: fqStatus.complianceStatus,
            nextDueDate: fqStatus.nextDueDate,
            ownershipPct: null,
            subsidiaryCount: 0,
            fqCount: 0,
            children: [],
            matchesSearch: matchedIds?.has(fq.id) ?? false,
          };
        },
      );

      const subsidiaries: ListChild[] = (edgesByParent.get(parentId) ?? [])
        .map((edge) => ({ edge, child: entityById.get(edge.childEntityId) }))
        .filter(
          (x): x is { edge: (typeof x)['edge']; child: EntityRecord } =>
            !!x.child,
        )
        .map(({ edge, child }) => {
          const childStatus = statusFor(child);
          return {
            id: child.id,
            entityName: child.entityName,
            registrationType: 'Entity' as const,
            relation: 'subsidiary' as const,
            jurisdiction: child.jurisdiction,
            entityType: child.entityType,
            entityStatus: child.entityStatus,
            complianceStatus: childStatus.complianceStatus,
            nextDueDate: childStatus.nextDueDate,
            ownershipPct: Number(edge.ownershipPct),
            subsidiaryCount: (edgesByParent.get(child.id) ?? []).length,
            fqCount: (fqsByDomesticId.get(child.id) ?? []).length,
            children: buildChildren(child.id),
            matchesSearch: matchedIds?.has(child.id) ?? false,
          };
        });

      return [...fqs, ...subsidiaries];
    };

    let rows = topLevel.map((entity) => {
      const { complianceStatus, nextDueDate } = statusFor(entity);
      return {
        id: entity.id,
        entityName: entity.entityName,
        registrationType: 'Entity' as const,
        jurisdiction: entity.jurisdiction,
        entityType: entity.entityType,
        entityStatus: entity.entityStatus,
        complianceStatus,
        nextDueDate,
        subsidiaryCount: (edgesByParent.get(entity.id) ?? []).length,
        fqCount: (fqsByDomesticId.get(entity.id) ?? []).length,
        children: buildChildren(entity.id),
        matchesSearch: matchedIds?.has(entity.id) ?? false,
      };
    });

    // A branch stays visible under a filter if it, or any of its
    // descendants at any depth, matches every active filter. `search` is
    // decided by DB membership in `matchedIds` above, not a JS string
    // comparison.
    const nodeMatches = (node: {
      id: string;
      entityStatus: string;
      complianceStatus: string;
      jurisdiction: string;
    }): boolean => {
      if (matchedIds && !matchedIds.has(node.id)) return false;
      if (query.entityStatus && node.entityStatus !== query.entityStatus)
        return false;
      if (
        query.complianceStatus &&
        node.complianceStatus !== query.complianceStatus
      )
        return false;
      if (query.jurisdiction && node.jurisdiction !== query.jurisdiction)
        return false;
      return true;
    };
    const subtreeMatches = (node: {
      id: string;
      entityStatus: string;
      complianceStatus: string;
      jurisdiction: string;
      children: ListChild[];
    }): boolean => nodeMatches(node) || node.children.some(subtreeMatches);

    rows = rows.filter(subtreeMatches);
    rows.sort((a, b) => a.entityName.localeCompare(b.entityName));

    const total = rows.length;
    const pageSize = query.pageSize ?? 10;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(query.page ?? 1, 1), totalPages);
    const start = (page - 1) * pageSize;
    const data = rows.slice(start, start + pageSize);

    return { data, page, pageSize, total, totalPages };
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
    const [entities, edges, filings] = await Promise.all([
      this.entityRepo.find(),
      this.edgeRepo.find(),
      this.filingRepo.find(),
    ]);

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

    let children: { entityName: string; pct: number; unallocatedPct: number }[] =
      [];
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
