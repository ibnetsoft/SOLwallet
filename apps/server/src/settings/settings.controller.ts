import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

/**
 * 공개 설정 API — 인증 불필요 (미니앱에서 수수료율 등 조회)
 */
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('fee-rate')
  async getFeeRate() {
    const feeRate = await this.settingsService.getFeeRate();
    return { success: true, data: { feeRate } };
  }
}
