import { Controller, Get } from '@nestjs/common';

/**
 * GET /health — 헬스체크 (배포 프로브용, /api 프리픽스 제외)
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
