import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Full default CSP everywhere...
  app.use(helmet());
  // ...except /api/docs: Swagger UI needs inline script/style to boot, so
  // this route gets its own relaxed policy instead of disabling CSP
  // app-wide. Registered after the app-wide helmet() above so it overrides
  // the header only for requests under this path.
  app.use(
    '/api/docs',
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          scriptSrc: [`'self'`, `'unsafe-inline'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:'],
        },
      },
    }),
  );
  // Below ~10KB, gzip's CPU cost isn't worth the bandwidth saved — skips
  // compression for small responses (health check, single-row lookups)
  // while still compressing larger ones (analytics, big /entities pages).
  app.use(compression({ threshold: 10 * 1000 }));

  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  app.enableCors({
    origin: corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Entity Registry API')
    .setDescription(
      `Upload entities/ownership/filings spreadsheets, browse the entity hierarchy, and pull
compliance analytics.

**Typical client flow:** \`POST /upload\` your three files → \`GET /entities\` to browse the
resulting hierarchy → \`GET /analytics\` for chart data. All endpoints are unauthenticated
and return JSON; errors follow a single consistent shape (see \`ErrorResponseDto\` on any
non-2xx response below).`,
    )
    .setVersion('1.0')
    .addTag(
      'upload',
      'Batch-load entities/ownership/filings spreadsheets. All-or-nothing per call.',
    )
    .addTag('entities', 'Browse the uploaded entity hierarchy.')
    .addTag('analytics', 'Aggregated/chart-ready views over the same data.')
    .addTag('health', 'Liveness check.')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  const port = process.env.PORT ?? 4000;
  await app.listen(port);

  console.log(`coverpin-backend listening on port ${port}`);

  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
}
void bootstrap();
