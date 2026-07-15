import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.SERVER_PORT || 3000;
  await app.listen(port);
  console.log(`🚀 SOLwallet Server running on http://localhost:${port}`);
}
bootstrap();
