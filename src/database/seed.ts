import 'dotenv/config';
import { AppDataSource } from './data-source';
import { ComplianceEntity, EntityStatus, EntityType } from '../entities/entity.entity';
import { Filing, FilingStatus, FilingType } from '../entities/filing.entity';

async function seed() {
  await AppDataSource.initialize();
  const entityRepo = AppDataSource.getRepository(ComplianceEntity);
  const filingRepo = AppDataSource.getRepository(Filing);

  const existing = await entityRepo.count();
  if (existing > 0) {
    console.log(`Skipping seed: ${existing} entities already exist.`);
    await AppDataSource.destroy();
    return;
  }

  const entities = await entityRepo.save([
    entityRepo.create({
      name: 'Acme Robotics LLC',
      entityType: EntityType.LLC,
      jurisdiction: 'US-DE',
      status: EntityStatus.ACTIVE,
      formationDate: '2021-06-01',
      registeredAgent: 'Northwest Registered Agent',
    }),
    entityRepo.create({
      name: 'Brightline Analytics Inc',
      entityType: EntityType.C_CORP,
      jurisdiction: 'US-CA',
      status: EntityStatus.ACTIVE,
      formationDate: '2019-03-15',
      registeredAgent: 'Cogency Global',
    }),
    entityRepo.create({
      name: 'Northstar Consulting Partnership',
      entityType: EntityType.PARTNERSHIP,
      jurisdiction: 'US-NY',
      status: EntityStatus.PENDING,
      formationDate: '2023-11-20',
      registeredAgent: null,
    }),
    entityRepo.create({
      name: 'Maple Health Foundation',
      entityType: EntityType.NONPROFIT,
      jurisdiction: 'CA-ON',
      status: EntityStatus.ACTIVE,
      formationDate: '2020-01-10',
      registeredAgent: 'ON Corporate Services',
    }),
  ]);

  await filingRepo.save([
    filingRepo.create({
      entityId: entities[0].id,
      filingType: FilingType.ANNUAL_REPORT,
      status: FilingStatus.PENDING,
      dueDate: '2026-12-31',
      notes: 'Delaware annual report + franchise tax due.',
    }),
    filingRepo.create({
      entityId: entities[0].id,
      filingType: FilingType.BOI_REPORT,
      status: FilingStatus.CONFIRMED,
      dueDate: '2025-01-01',
      notes: 'Filed with FinCEN.',
    }),
    filingRepo.create({
      entityId: entities[1].id,
      filingType: FilingType.FRANCHISE_TAX,
      status: FilingStatus.AI_PROCESSING,
      dueDate: '2026-09-15',
    }),
    filingRepo.create({
      entityId: entities[2].id,
      filingType: FilingType.REGISTERED_AGENT_RENEWAL,
      status: FilingStatus.PENDING,
      dueDate: '2026-11-20',
    }),
  ]);

  console.log(`Seeded ${entities.length} entities with filings.`);
  await AppDataSource.destroy();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
