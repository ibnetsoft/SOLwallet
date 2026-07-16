import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// .env 파일 로드 — 루트 디렉토리 우선, 다음 현재 디렉토리
loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../../.env') });
loadEnv(); // 기본: process.cwd()/.env

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // JWT_SECRET 필수 검증 — 없으면 부트 중단 (토큰 위조 방지)
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    logger.error('JWT_SECRET 환경변수가 설정되지 않았거나 32자 미만입니다. 서버를 시작할 수 없습니다.');
    process.exit(1);
  }

  // ADMIN_SECRET 필수 검증
  if (!process.env.ADMIN_SECRET || process.env.ADMIN_SECRET === 'change-this-to-your-own-secret') {
    logger.error('ADMIN_SECRET 환경변수가 기본값이거나 설정되지 않았습니다. 고유한 값을 설정하세요.');
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);
  logger.log('App created');

  // CORS — Mini-App 및 Admin에서 API 호출 허용
  app.enableCors({
    origin: [
      process.env.MINI_APP_URL || 'http://localhost:3001',
      process.env.ADMIN_APP_URL || 'http://localhost:3002',
    ],
    credentials: true,
  });
  logger.log('CORS enabled');

  // API 라우트 프리픽스
  app.setGlobalPrefix('api', {
    exclude: ['/health'],
  });
  logger.log('Prefix set');

  // Global ValidationPipe — DTO 자동 검증
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  logger.log('Pipes set');

  // Global Exception Filter — 일관된 에러 응답
  app.useGlobalFilters(new GlobalExceptionFilter());
  logger.log('Filters set');

  const port = process.env.SERVER_PORT || 3000;

  logger.log('Attempting to listen on port ' + port + '...');
  await app.listen(port);
  logger.log(`🚀 SOLwallet Server running on http://localhost:${port}`);
}
bootstrap();
