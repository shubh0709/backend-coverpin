import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supports two query patterns that used to be served by loading the whole
 * entities table into the app and scanning it in JS:
 *  - GET /entities/suggestions and the list endpoint's subtree search now
 *    run `entity_name ILIKE '%term%'` in Postgres — a trigram (pg_trgm)
 *    index is what makes that fast instead of a sequential scan.
 *  - GET /entities now filters top-level entities by jurisdiction/
 *    entity_status directly in SQL instead of after loading everything.
 *  - domestic_entity_id backs the FQ leg of the recursive subtree walk
 *    (RegistryService's SUBTREE_CTE), joined on for every list/search request.
 */
export class AddSearchAndFilterIndexes1735300000003 implements MigrationInterface {
  name = 'AddSearchAndFilterIndexes1735300000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    await queryRunner.query(`
      CREATE INDEX "idx_entities_name_trgm" ON "entities"
        USING gin ("entity_name" gin_trgm_ops);
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_entities_jurisdiction" ON "entities" ("jurisdiction");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_entities_entity_status" ON "entities" ("entity_status");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_entities_domestic_entity_id" ON "entities" ("domestic_entity_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_entities_domestic_entity_id";`);
    await queryRunner.query(`DROP INDEX "idx_entities_entity_status";`);
    await queryRunner.query(`DROP INDEX "idx_entities_jurisdiction";`);
    await queryRunner.query(`DROP INDEX "idx_entities_name_trgm";`);
  }
}
