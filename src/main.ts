import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';

async function bootstrap() {
  // rawBody required for Stripe webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  const isProd = config.get('NODE_ENV') === 'production';

  const corsOrigin = config.get<string>('CORS_ORIGIN');
  if (isProd && !corsOrigin) {
    throw new Error(
      'CORS_ORIGIN must be set in production (comma-separated origins)',
    );
  }

  app.enableCors({
    origin: corsOrigin
      ? corsOrigin.split(',').map((v) => v.trim())
      : true,
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  await app.listen(3000);

  console.log('🚀 API running on http://localhost:3000/api');
}

void bootstrap();
