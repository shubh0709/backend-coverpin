import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1787815755404 implements MigrationInterface {
    name = 'InitSchema1787815755404'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."filings_filingtype_enum" AS ENUM('ANNUAL_REPORT', 'BOI_REPORT', 'REGISTERED_AGENT_RENEWAL', 'FRANCHISE_TAX', 'OTHER')`);
        await queryRunner.query(`CREATE TYPE "public"."filings_status_enum" AS ENUM('PENDING', 'AI_PROCESSING', 'FILED', 'CONFIRMED')`);
        await queryRunner.query(`CREATE TABLE "filings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "entityId" uuid NOT NULL, "filingType" "public"."filings_filingtype_enum" NOT NULL, "status" "public"."filings_status_enum" NOT NULL DEFAULT 'PENDING', "dueDate" date, "notes" character varying(500), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_48cb6370a96594b0b3c61df98be" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_df6baff4fb694fb96927085211" ON "filings" ("entityId") `);
        await queryRunner.query(`CREATE INDEX "IDX_4e1d3ff69f7343278a0e65bcd4" ON "filings" ("status") `);
        await queryRunner.query(`CREATE TYPE "public"."compliance_entities_entitytype_enum" AS ENUM('LLC', 'C_CORP', 'S_CORP', 'PARTNERSHIP', 'NONPROFIT')`);
        await queryRunner.query(`CREATE TYPE "public"."compliance_entities_status_enum" AS ENUM('ACTIVE', 'PENDING', 'SUSPENDED', 'DISSOLVED')`);
        await queryRunner.query(`CREATE TABLE "compliance_entities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "entityType" "public"."compliance_entities_entitytype_enum" NOT NULL, "jurisdiction" character varying(16) NOT NULL, "status" "public"."compliance_entities_status_enum" NOT NULL DEFAULT 'PENDING', "formationDate" date, "registeredAgent" character varying(255), "lastComplianceCheck" jsonb, "lastCheckedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d38c6f9e916e525db9e67859d2b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_463501b7183624e2c5f226da87" ON "compliance_entities" ("jurisdiction") `);
        await queryRunner.query(`CREATE INDEX "IDX_7b9b6444656e1924ac9bd2f42d" ON "compliance_entities" ("status") `);
        await queryRunner.query(`ALTER TABLE "filings" ADD CONSTRAINT "FK_df6baff4fb694fb96927085211f" FOREIGN KEY ("entityId") REFERENCES "compliance_entities"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "filings" DROP CONSTRAINT "FK_df6baff4fb694fb96927085211f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7b9b6444656e1924ac9bd2f42d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_463501b7183624e2c5f226da87"`);
        await queryRunner.query(`DROP TABLE "compliance_entities"`);
        await queryRunner.query(`DROP TYPE "public"."compliance_entities_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."compliance_entities_entitytype_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4e1d3ff69f7343278a0e65bcd4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_df6baff4fb694fb96927085211"`);
        await queryRunner.query(`DROP TABLE "filings"`);
        await queryRunner.query(`DROP TYPE "public"."filings_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."filings_filingtype_enum"`);
    }

}
