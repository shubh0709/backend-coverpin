import {
  ENTITY_STATUSES,
  ENTITY_TYPES,
  GLOBAL_REGIONS,
  REGISTRATION_TYPES,
  TERMINAL_ENTITY_STATUSES,
} from '../entities/entity.entity';
import { ParsedSheet } from '../parsing/file-parser.service';
import { ValidationError } from './types';
import {
  isBlank,
  isFutureDate,
  isValidJurisdictionFormat,
  makeError,
  parseDate,
} from './common';
import { checkHeaderSchema } from './schema-registry';

const FILE = 'entities.csv';

export interface ParsedEntityRow {
  line: number;
  entityName: string;
  registrationType: 'Entity' | 'FQ';
  jurisdiction: string;
  entityType: string;
  entityStatus: string;
  statusDate: Date | null;
  domesticEntity: string | null;
  formationDate: Date | null;
  businessId: string | null;
  globalRegion: string | null;
}

export function validateEntitiesSheet(
  sheet: ParsedSheet,
  today: Date,
): { errors: ValidationError[]; rows: ParsedEntityRow[] } {
  const errors: ValidationError[] = [];
  const err = (line: number, column: string, message: string) =>
    makeError(FILE, line, column, message);

  const colIndex = new Map(sheet.header.map((h, i) => [h, i]));
  const schemaErrors = checkHeaderSchema('entities', sheet.header);
  if (schemaErrors.length > 0) {
    return { errors: schemaErrors, rows: [] };
  }

  const get = (cells: string[], column: string) =>
    (cells[colIndex.get(column)!] ?? '').trim();

  const candidateRows: ParsedEntityRow[] = [];

  for (const row of sheet.rows) {
    const entityName = get(row.cells, 'Entity Name');
    const registrationType = get(row.cells, 'Registration Type');
    const jurisdiction = get(row.cells, 'Jurisdiction');
    const entityType = get(row.cells, 'Entity Type');
    const entityStatus = get(row.cells, 'Entity Status');
    const statusDateRaw = get(row.cells, 'Status Date');
    const domesticEntity = get(row.cells, 'Domestic Entity');
    const formationDateRaw = get(row.cells, 'Formation Date');
    const businessId = get(row.cells, 'Entity/Business ID');
    const globalRegion = get(row.cells, 'Global Region');

    if (isBlank(entityName))
      errors.push(err(row.line, 'Entity Name', 'Entity Name is required.'));

    if (isBlank(registrationType)) {
      errors.push(
        err(row.line, 'Registration Type', 'Registration Type is required.'),
      );
    } else if (
      !(REGISTRATION_TYPES as readonly string[]).includes(registrationType)
    ) {
      errors.push(
        err(
          row.line,
          'Registration Type',
          `Registration Type must be one of: ${REGISTRATION_TYPES.join(', ')} (got '${registrationType}').`,
        ),
      );
    }

    if (isBlank(jurisdiction)) {
      errors.push(err(row.line, 'Jurisdiction', 'Jurisdiction is required.'));
    } else if (!isValidJurisdictionFormat(jurisdiction)) {
      errors.push(
        err(
          row.line,
          'Jurisdiction',
          `Jurisdiction must be 'Country' or 'Country/State' (e.g. 'United States/Delaware'), got '${jurisdiction}'.`,
        ),
      );
    }

    if (isBlank(entityType)) {
      errors.push(err(row.line, 'Entity Type', 'Entity Type is required.'));
    } else if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) {
      errors.push(
        err(
          row.line,
          'Entity Type',
          `Entity Type must be one of: ${ENTITY_TYPES.join(', ')} (got '${entityType}').`,
        ),
      );
    }

    let entityStatusIsValid = false;
    if (isBlank(entityStatus)) {
      errors.push(err(row.line, 'Entity Status', 'Entity Status is required.'));
    } else if (!(ENTITY_STATUSES as readonly string[]).includes(entityStatus)) {
      errors.push(
        err(
          row.line,
          'Entity Status',
          `Entity Status must be one of: ${ENTITY_STATUSES.join(', ')} (got '${entityStatus}').`,
        ),
      );
    } else {
      entityStatusIsValid = true;
    }

    let statusDate: Date | null = null;
    if (!isBlank(statusDateRaw)) {
      statusDate = parseDate(statusDateRaw) ?? null;
      if (!statusDate) {
        errors.push(
          err(
            row.line,
            'Status Date',
            `Status Date '${statusDateRaw}' is not a valid date (use YYYY-MM-DD or MM/DD/YYYY).`,
          ),
        );
      }
    }
    if (
      entityStatusIsValid &&
      TERMINAL_ENTITY_STATUSES.has(entityStatus) &&
      isBlank(statusDateRaw)
    ) {
      errors.push(
        err(
          row.line,
          'Status Date',
          `Status Date is required when Entity Status is '${entityStatus}'.`,
        ),
      );
    }

    const isFQ = registrationType.trim() === 'FQ';
    const isEntityType = registrationType.trim() === 'Entity';
    if (isFQ && isBlank(domesticEntity)) {
      errors.push(
        err(
          row.line,
          'Domestic Entity',
          `Domestic Entity is required when Registration Type is 'FQ'.`,
        ),
      );
    }
    if (isEntityType && !isBlank(domesticEntity)) {
      errors.push(
        err(
          row.line,
          'Domestic Entity',
          `Domestic Entity must be empty when Registration Type is 'Entity'.`,
        ),
      );
    }

    let formationDate: Date | null = null;
    if (!isBlank(formationDateRaw)) {
      formationDate = parseDate(formationDateRaw) ?? null;
      if (!formationDate) {
        errors.push(
          err(
            row.line,
            'Formation Date',
            `Formation Date '${formationDateRaw}' is not a valid date (use YYYY-MM-DD or MM/DD/YYYY).`,
          ),
        );
      } else if (isFutureDate(formationDate, today)) {
        errors.push(
          err(
            row.line,
            'Formation Date',
            'Formation Date cannot be in the future.',
          ),
        );
      }
    }

    if (
      !isBlank(globalRegion) &&
      !(GLOBAL_REGIONS as readonly string[]).includes(globalRegion)
    ) {
      errors.push(
        err(
          row.line,
          'Global Region',
          `Global Region must be one of: ${GLOBAL_REGIONS.join(', ')} (got '${globalRegion}').`,
        ),
      );
    }

    candidateRows.push({
      line: row.line,
      entityName,
      registrationType: registrationType as 'Entity' | 'FQ',
      jurisdiction,
      entityType,
      entityStatus,
      statusDate,
      domesticEntity: isFQ
        ? isBlank(domesticEntity)
          ? null
          : domesticEntity
        : null,
      formationDate,
      businessId: isBlank(businessId) ? null : businessId,
      globalRegion: isBlank(globalRegion) ? null : globalRegion,
    });
  }

  // Entity Name must be unique within the sheet.
  const linesByName = new Map<string, number[]>();
  for (const row of candidateRows) {
    if (isBlank(row.entityName)) continue;
    const lines = linesByName.get(row.entityName) ?? [];
    lines.push(row.line);
    linesByName.set(row.entityName, lines);
  }
  for (const [name, lines] of linesByName) {
    if (lines.length > 1) {
      for (const line of lines) {
        errors.push(
          err(
            line,
            'Entity Name',
            `Entity Name '${name}' appears ${lines.length} times in this file; it must be unique.`,
          ),
        );
      }
    }
  }

  // Entity/Business ID must be unique where present, within the sheet.
  const linesByBusinessId = new Map<string, number[]>();
  for (const row of candidateRows) {
    if (!row.businessId) continue;
    const lines = linesByBusinessId.get(row.businessId) ?? [];
    lines.push(row.line);
    linesByBusinessId.set(row.businessId, lines);
  }
  for (const [businessId, lines] of linesByBusinessId) {
    if (lines.length > 1) {
      for (const line of lines) {
        errors.push(
          err(
            line,
            'Entity/Business ID',
            `Entity/Business ID '${businessId}' appears ${lines.length} times in this file; it must be unique.`,
          ),
        );
      }
    }
  }

  // Domestic Entity must reference an existing Entity-type row within this same file.
  const typeByName = new Map<string, 'Entity' | 'FQ'>();
  for (const row of candidateRows) {
    if (
      !isBlank(row.entityName) &&
      (row.registrationType === 'Entity' || row.registrationType === 'FQ')
    ) {
      typeByName.set(row.entityName, row.registrationType);
    }
  }
  for (const row of candidateRows) {
    if (!row.domesticEntity) continue;
    const refType = typeByName.get(row.domesticEntity);
    if (refType === undefined) {
      errors.push(
        err(
          row.line,
          'Domestic Entity',
          `Domestic Entity '${row.domesticEntity}' does not match any Entity Name in entities.csv.`,
        ),
      );
    } else if (refType !== 'Entity') {
      errors.push(
        err(
          row.line,
          'Domestic Entity',
          `Domestic Entity '${row.domesticEntity}' must reference a row with Registration Type 'Entity', not 'FQ'.`,
        ),
      );
    }
  }

  const erroredLines = new Set(errors.map((e) => e.line));
  const rows = candidateRows.filter((row) => !erroredLines.has(row.line));

  return { errors, rows };
}
