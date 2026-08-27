import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntityRecord } from '../entities/entity.entity';
import { OwnershipEdge } from '../entities/ownership-edge.entity';
import { FileParserService } from '../parsing/file-parser.service';
import { ValidationError } from './types';
import { makeError } from './common';
import { ParsedEntityRow, validateEntitiesSheet } from './entities-validator';
import {
  ParsedOwnershipRow,
  validateOwnershipSheet,
} from './ownership-validator';
import { ParsedFilingRow, validateFilingsSheet } from './filings-validator';
import { validateOwnershipGraph } from './graph-validator';

export interface UploadFiles {
  entities: Express.Multer.File;
  ownership: Express.Multer.File;
  filings: Express.Multer.File;
}

export interface ValidatedUpload {
  errors: ValidationError[];
  entityRows: ParsedEntityRow[];
  ownershipRows: ParsedOwnershipRow[];
  filingRows: ParsedFilingRow[];
}

const FILE_ORDER = ['entities.csv', 'ownership.csv', 'filings.csv'];

@Injectable()
export class ValidationService {
  constructor(
    @InjectRepository(EntityRecord)
    private readonly entityRepo: Repository<EntityRecord>,
    @InjectRepository(OwnershipEdge)
    private readonly edgeRepo: Repository<OwnershipEdge>,
    private readonly parser: FileParserService,
  ) {}

  async validateUpload(files: UploadFiles): Promise<ValidatedUpload> {
    const today = new Date();

    const entitiesSheet = this.parser.parse(files.entities);
    const ownershipSheet = this.parser.parse(files.ownership);
    const filingsSheet = this.parser.parse(files.filings);

    const { errors: entityErrors, rows: entityRows } = validateEntitiesSheet(
      entitiesSheet,
      today,
    );
    const entityTypeByName = new Map(
      entityRows.map((r) => [r.entityName, r.registrationType]),
    );

    const { errors: ownershipErrors, rows: ownershipRows } =
      validateOwnershipSheet(ownershipSheet, entityTypeByName);
    const { errors: filingErrors, rows: filingRows } = validateFilingsSheet(
      filingsSheet,
      new Set(entityTypeByName.keys()),
      today,
    );

    const businessIdErrors =
      await this.validateBusinessIdsAgainstDb(entityRows);

    const existingEdges = await this.loadExistingEdges();
    const graphErrors = validateOwnershipGraph(ownershipRows, existingEdges);

    const errors = [
      ...entityErrors,
      ...businessIdErrors,
      ...ownershipErrors,
      ...graphErrors,
      ...filingErrors,
    ].sort(
      (a, b) =>
        FILE_ORDER.indexOf(a.file) - FILE_ORDER.indexOf(b.file) ||
        a.line - b.line ||
        a.column.localeCompare(b.column),
    );

    return { errors, entityRows, ownershipRows, filingRows };
  }

  private async loadExistingEdges() {
    const edges = await this.edgeRepo.find({
      relations: ['parentEntity', 'childEntity'],
    });
    return edges.map((edge) => ({
      parentName: edge.parentEntity.entityName,
      childName: edge.childEntity.entityName,
      pct: Number(edge.ownershipPct),
    }));
  }

  private async validateBusinessIdsAgainstDb(
    rows: ParsedEntityRow[],
  ): Promise<ValidationError[]> {
    const candidates = rows.filter(
      (r): r is ParsedEntityRow & { businessId: string } =>
        r.businessId !== null,
    );
    if (candidates.length === 0) return [];

    const businessIds = [...new Set(candidates.map((r) => r.businessId))];
    const existing = await this.entityRepo
      .createQueryBuilder('e')
      .where('e.business_id IN (:...businessIds)', { businessIds })
      .getMany();
    const ownerNameByBusinessId = new Map(
      existing.map((e) => [e.businessId as string, e.entityName]),
    );

    const errors: ValidationError[] = [];
    for (const row of candidates) {
      const owner = ownerNameByBusinessId.get(row.businessId);
      if (owner && owner !== row.entityName) {
        errors.push(
          makeError(
            'entities.csv',
            row.line,
            'Entity/Business ID',
            `Entity/Business ID '${row.businessId}' is already used by a different entity ('${owner}').`,
          ),
        );
      }
    }
    return errors;
  }
}
