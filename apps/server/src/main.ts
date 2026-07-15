import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS — Mini-App 및 Admin에서 API 호출 허용
  app.enableCors({
    origin: [
      process.env.MINI_APP_URL || 'http://localhost:3001',
      process.env.ADMIN_APP_URL || 'http://localhost:3002',
    ],
    credentials: true,
  });

  // API 라우트 프리픽스 (선택사항 — 현재는 컨트롤러에서 /api/ 로 직접 지정)
  app.setGlobalPrefix('api', {
    exclude: ['/health'],
  });

  const port = process.env.SERVER_PORT || 3000;
  await app.listen(port);
  console.log(`🚀 SOLwallet Server running on http://localhost:${port}`);
}
bootstrap();
