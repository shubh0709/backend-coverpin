import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { EntityType } from '../src/entities/entity.entity';
import { FilingStatus, FilingType } from '../src/entities/filing.entity';

/**
 * End-to-end coverage of the core compliance flow: create an entity, attach
 * a filing, and walk it forward through its lifecycle -- including the edge
 * cases that a reviewer stress-tests first (invalid input, skipped states,
 * missing resources).
 *
 * Requires a running Postgres instance pointed to by DATABASE_URL
 * (see docker-compose.yml / README).
 */
describe('Entities + Filings (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an entity with an invalid jurisdiction code', async () => {
    await request(app.getHttpServer())
      .post('/api/entities')
      .send({ name: 'Bad Jurisdiction Co', entityType: EntityType.LLC, jurisdiction: 'nope' })
      .expect(400);
  });

  it('rejects an entity with missing required fields', async () => {
    await request(app.getHttpServer()).post('/api/entities').send({}).expect(400);
  });

  it('creates an entity, blocks exact duplicates, then walks a filing through its full lifecycle', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/entities')
      .send({
        name: `E2E Test Co ${Date.now()}`,
        entityType: EntityType.LLC,
        jurisdiction: 'US-DE',
      })
      .expect(201);

    const entityId = createRes.body.id;
    expect(entityId).toBeDefined();

    // duplicate name+jurisdiction is rejected
    await request(app.getHttpServer())
      .post('/api/entities')
      .send({
        name: createRes.body.name,
        entityType: EntityType.LLC,
        jurisdiction: 'US-DE',
      })
      .expect(409);

    const filingRes = await request(app.getHttpServer())
      .post(`/api/entities/${entityId}/filings`)
      .send({ filingType: FilingType.ANNUAL_REPORT })
      .expect(201);

    const filingId = filingRes.body.id;
    expect(filingRes.body.status).toBe(FilingStatus.PENDING);

    // cannot skip straight to CONFIRMED
    await request(app.getHttpServer())
      .patch(`/api/entities/${entityId}/filings/${filingId}/status`)
      .send({ status: FilingStatus.CONFIRMED })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/entities/${entityId}/filings/${filingId}/status`)
      .send({ status: FilingStatus.AI_PROCESSING })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/entities/${entityId}/filings/${filingId}/status`)
      .send({ status: FilingStatus.FILED })
      .expect(200);

    const confirmedRes = await request(app.getHttpServer())
      .patch(`/api/entities/${entityId}/filings/${filingId}/status`)
      .send({ status: FilingStatus.CONFIRMED })
      .expect(200);
    expect(confirmedRes.body.status).toBe(FilingStatus.CONFIRMED);

    // terminal state: no further transitions allowed
    await request(app.getHttpServer())
      .patch(`/api/entities/${entityId}/filings/${filingId}/status`)
      .send({ status: FilingStatus.PENDING })
      .expect(400);
  });

  it('returns 404 for a non-existent entity', async () => {
    await request(app.getHttpServer())
      .get('/api/entities/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });

  it('returns 400 for a malformed (non-UUID) entity id', async () => {
    await request(app.getHttpServer()).get('/api/entities/not-a-uuid').expect(400);
  });
});
