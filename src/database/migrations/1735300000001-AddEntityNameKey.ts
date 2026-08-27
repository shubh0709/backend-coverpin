import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Entity Name matching is trimmed and case-insensitive everywhere it's
 * compared (natural-key upserts, in-sheet uniqueness, every cross-file
 * reference lookup) — "Acme Corp", "acme corp", and " Acme Corp " must all
 * resolve to the same row. Postgres has no case-insensitive unique
 * constraint on plain text, so this stores the normalized form in its own
 * column and enforces uniqueness there; entity_name itself keeps the
 * original casing/whitespace as uploaded for display.
 */
export class AddEntityNameKey1735300000001 implements MigrationInterface {
  name = 'AddEntityNameKey1735300000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "entities" ADD COLUMN "entity_name_key" text;
    `);
    await queryRunner.query(`
      UPDATE "entities" SET "entity_name_key" = lower(trim("entity_name"));
    `);
    await queryRunner.query(`
      ALTER TABLE "entities" ALTER COLUMN "entity_name_key" SET NOT NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "entities_entity_name_key_unique"
        ON "entities" ("entity_name_key");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "entities_entity_name_key_unique";`,
    );
    await queryRunner.query(
      `ALTER TABLE "entities" DROP COLUMN "entity_name_key";`,
    );
  }
}
