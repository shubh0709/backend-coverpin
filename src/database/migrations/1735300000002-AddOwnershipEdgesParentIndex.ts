import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ownership_edges had an index on child_entity_id but not parent_entity_id,
 * even though walking the ownership tree top-down (every subsidiary/FQ
 * expansion in RegistryService) groups edges by parent_entity_id.
 */
export class AddOwnershipEdgesParentIndex1735300000002
  implements MigrationInterface
{
  name = 'AddOwnershipEdgesParentIndex1735300000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "idx_ownership_edges_parent" ON "ownership_edges" ("parent_entity_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_ownership_edges_parent";`);
  }
}
