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
import { toDateOnlyString } from './validation/common';
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
          ['entityName'],
        );
      }

      const allEntities = await entityRepo.find();
      const idByName = new Map(allEntities.map((e) => [e.entityName, e.id]));

      // Pass 2: now that every row in this batch has an id, wire up FQ -> domestic entity.
      for (const row of entityRows) {
        if (row.registrationType === 'FQ') {
          await entityRepo.update(
            { entityName: row.entityName },
            {
              domesticEntityId: row.domesticEntity
                ? (idByName.get(row.domesticEntity) ?? null)
                : null,
            },
          );
        }
      }

      for (const row of ownershipRows) {
        const parentEntityId = idByName.get(row.parentEntity);
        const childEntityId = idByName.get(row.childEntity);
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
        const entityId = idByName.get(row.entityName);
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

    let rows = topLevel.map((entity) => {
      const { complianceStatus, nextDueDate } = statusFor(entity);

      const fqs: ListChild[] = (fqsByDomesticId.get(entity.id) ?? []).map(
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
          };
        },
      );

      const subsidiaries: ListChild[] = (edgesByParent.get(entity.id) ?? [])
        .map((edge) => entityById.get(edge.childEntityId))
        .filter((child): child is EntityRecord => !!child)
        .map((child) => {
          const edge = (edgesByParent.get(entity.id) ?? []).find(
            (e) => e.childEntityId === child.id,
          )!;
          const childStatus = statusFor(child);
          return {
            id: child.id,
            entityName: child.entityName,
            registrationType: 'Entity',
            relation: 'subsidiary',
            jurisdiction: child.jurisdiction,
            entityType: child.entityType,
            entityStatus: child.entityStatus,
            complianceStatus: childStatus.complianceStatus,
            nextDueDate: childStatus.nextDueDate,
            ownershipPct: Number(edge.ownershipPct),
          };
        });

      return {
        id: entity.id,
        entityName: entity.entityName,
        registrationType: 'Entity' as const,
        jurisdiction: entity.jurisdiction,
        entityType: entity.entityType,
        entityStatus: entity.entityStatus,
        complianceStatus,
        nextDueDate,
        subsidiaryCount: subsidiaries.length,
        fqCount: fqs.length,
        children: [...fqs, ...subsidiaries],
      };
    });

    if (query.search) {
      const term = query.search.trim().toLowerCase();
      rows = rows.filter((r) => r.entityName.toLowerCase().includes(term));
    }
    if (query.entityStatus)
      rows = rows.filter((r) => r.entityStatus === query.entityStatus);
    if (query.complianceStatus)
      rows = rows.filter((r) => r.complianceStatus === query.complianceStatus);
    if (query.jurisdiction)
      rows = rows.filter((r) => r.jurisdiction === query.jurisdiction);

    rows.sort((a, b) => a.entityName.localeCompare(b.entityName));

    return { data: rows };
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

    // (c) subsidiary vs FQ count per top-level entity, including zero counts.
    const childEntityIds = new Set(edges.map((e) => e.childEntityId));
    const edgesByParent = groupBy(edges, (e) => e.parentEntityId);
    const fqsByDomesticId = groupBy(
      entities.filter((e) => e.registrationType === 'FQ' && e.domesticEntityId),
      (e) => e.domesticEntityId as string,
    );
    const topLevel = filteredEntities.filter(
      (e) => e.registrationType === 'Entity' && !childEntityIds.has(e.id),
    );
    const subsidiaryFqCountByTopLevel = topLevel.map((entity) => ({
      entityName: entity.entityName,
      subsidiaries: (edgesByParent.get(entity.id) ?? []).length,
      fqs: (fqsByDomesticId.get(entity.id) ?? []).length,
    }));

    // (d) ownership % across a selected parent's children, with unallocated remainder.
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

    let children: { entityName: string; pct: number }[] = [];
    let unallocatedPct = 0;
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
      children = parentEdges.map((edge) => ({
        entityName: entityById.get(edge.childEntityId)!.entityName,
        pct: Number(edge.ownershipPct),
      }));
      const allocated = children.reduce((sum, c) => sum + c.pct, 0);
      unallocatedPct = Math.max(0, Math.round((100 - allocated) * 100) / 100);
    }

    return {
      complianceBreakdown,
      entityStatusByRegion,
      subsidiaryFqCountByTopLevel,
      ownershipByParent: {
        parents,
        selectedParentId,
        children,
        unallocatedPct,
      },
    };
  }
}
