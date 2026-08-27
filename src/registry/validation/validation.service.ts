import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntityRecord } from '../entities/entity.entity';
import { OwnershipEdge } from '../entities/ownership-edge.entity';
import {
  FileParseError,
  FileParserService,
  ParsedSheet,
} from '../parsing/file-parser.service';
import { ValidationError } from './types';
import { makeError, normalizeName } from './common';
import { ParsedEntityRow, validateEntitiesSheet } from './entities-validator';
import {
  ParsedOwnershipRow,
  validateOwnershipSheet,
} from './ownership-validator';
import { ParsedFilingRow, validateFilingsSheet } from './filings-validator';
import { validateOwnershipGraph } from './graph-validator';
import { SLOT_SCHEMAS, UploadSlot } from './schema-registry';

export interface UploadFiles {
  entities?: Express.Multer.File;
  ownership?: Express.Multer.File;
  filings?: Express.Multer.File;
}

export interface ValidatedUpload {
  errors: ValidationError[];
  entityRows: ParsedEntityRow[];
  ownershipRows: ParsedOwnershipRow[];
  filingRows: ParsedFilingRow[];
}

const FILE_ORDER: string[] = [
  SLOT_SCHEMAS.entities.file,
  SLOT_SCHEMAS.ownership.file,
  SLOT_SCHEMAS.filings.file,
];

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
    const structuralErrors: ValidationError[] = [];

    const parseSlot = (
      file: Express.Multer.File | undefined,
      slot: UploadSlot,
    ): ParsedSheet | null => {
      const expected = SLOT_SCHEMAS[slot];
      if (!file) {
        structuralErrors.push(
          makeError(
            expected.file,
            1,
            'File',
            'This file is required but was not uploaded.',
          ),
        );
        return null;
      }
      try {
        return this.parser.parse(file, expected.file);
      } catch (e) {
        if (e instanceof FileParseError) {
          structuralErrors.push(e.validationError);
          return null;
        }
        throw e;
      }
    };

    const entitiesSheet = parseSlot(files.entities, 'entities');
    const ownershipSheet = parseSlot(files.ownership, 'ownership');
    const filingsSheet = parseSlot(files.filings, 'filings');

    const { errors: entityErrors, rows: entityRows } = entitiesSheet
      ? validateEntitiesSheet(entitiesSheet, today)
      : { errors: [] as ValidationError[], rows: [] as ParsedEntityRow[] };

    // Both keyed by normalized (trimmed, lowercased) Entity Name — matching
    // is case-insensitive everywhere Entity Name is compared (§8).
    const entityTypeByName = new Map(
      entityRows.map((r) => [normalizeName(r.entityName), r.registrationType]),
    );
    const entityJurisdictionByName = new Map(
      entityRows.map((r) => [normalizeName(r.entityName), r.jurisdiction]),
    );

    const { errors: ownershipErrors, rows: ownershipRows } = ownershipSheet
      ? validateOwnershipSheet(ownershipSheet, entityTypeByName)
      : { errors: [] as ValidationError[], rows: [] as ParsedOwnershipRow[] };
    const { errors: filingErrors, rows: filingRows } = filingsSheet
      ? validateFilingsSheet(filingsSheet, entityJurisdictionByName, today)
      : { errors: [] as ValidationError[], rows: [] as ParsedFilingRow[] };

    const businessIdErrors =
      await this.validateBusinessIdsAgainstDb(entityRows);

    const existingEdges = await this.loadExistingEdges();
    const graphErrors = validateOwnershipGraph(ownershipRows, existingEdges);

    const errors = [
      ...structuralErrors,
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
      if (owner && normalizeName(owner) !== normalizeName(row.entityName)) {
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
