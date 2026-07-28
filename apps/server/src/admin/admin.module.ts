import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SubAdminController } from './subadmin.controller';
import { SubAdminService } from './subadmin.service';
import { BalanceModule } from '../balance/balance.module';

@Module({
  imports: [AuthModule, BalanceModule],
  controllers: [AdminController, SubAdminController],
  providers: [AdminService, SubAdminService],
  exports: [AdminService, SubAdminService],
})
export class AdminModule {}
