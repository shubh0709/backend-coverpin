import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitRegistrySchema1735300000000 implements MigrationInterface {
  name = 'InitRegistrySchema1735300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "entities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "entity_name" text NOT NULL UNIQUE,
        "registration_type" text NOT NULL CHECK ("registration_type" IN ('Entity','FQ')),
        "jurisdiction" text NOT NULL,
        "entity_type" text NOT NULL CHECK ("entity_type" IN (
          'Corporation','Limited Liability Company','Limited Partnership',
          'General Partnership','Nonprofit','Trust')),
        "entity_status" text NOT NULL CHECK ("entity_status" IN (
          'In Formation','Active','Revoked/Terminated','Merged/Acquired',
          'Divested/Sold','Dormant','Dissolved')),
        "status_date" date,
        "domestic_entity_id" uuid REFERENCES "entities"("id"),
        "formation_date" date,
        "business_id" text,
        "global_region" text CHECK ("global_region" IN (
          'North America','Asia Pacific','Europe Middle East Africa',
          'Latin America','European Economic Area')),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "entities_business_id_unique"
        ON "entities" ("business_id") WHERE "business_id" IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE "ownership_edges" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "parent_entity_id" uuid NOT NULL REFERENCES "entities"("id"),
        "child_entity_id" uuid NOT NULL REFERENCES "entities"("id"),
        "ownership_pct" numeric(5,2) NOT NULL CHECK ("ownership_pct" > 0 AND "ownership_pct" <= 100),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("parent_entity_id", "child_entity_id"),
        CHECK ("parent_entity_id" <> "child_entity_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "filings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "entity_id" uuid NOT NULL REFERENCES "entities"("id"),
        "filing_type" text NOT NULL CHECK ("filing_type" IN (
          'Annual Report','Statement of Information','Franchise Tax','Biennial Statement')),
        "jurisdiction" text NOT NULL,
        "filing_authority" text,
        "due_date" date NOT NULL,
        "filed_date" date,
        "status" text NOT NULL CHECK ("status" IN (
          'Not Started','In Progress','Submitted','Filed','Rejected','Canceled')),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("entity_id", "filing_type", "due_date")
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_ownership_edges_child" ON "ownership_edges" ("child_entity_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_filings_entity" ON "filings" ("entity_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "filings";`);
    await queryRunner.query(`DROP TABLE "ownership_edges";`);
    await queryRunner.query(`DROP TABLE "entities";`);
  }
}
