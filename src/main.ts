import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildCorsOptions } from './common/cors.util';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';

async function bootstrap() {
  // rawBody required for Stripe webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  const isProd = config.get('NODE_ENV') === 'production';

  app.enableCors(
    buildCorsOptions({
      corsOrigin: config.get<string>('CORS_ORIGIN'),
      allowVercelPreviews: config.get<string>('CORS_ALLOW_VERCEL_PREVIEWS'),
      isProd,
    }),
  );

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  const port = Number(config.get('PORT') ?? 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 API running on http://0.0.0.0:${port}/api`);
}

void bootstrap();
