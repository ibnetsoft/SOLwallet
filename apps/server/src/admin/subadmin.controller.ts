import { Controller, Get, Post, Delete, Body, Param, UseGuards, UnauthorizedException, Req } from '@nestjs/common';
import { SubAdminService } from './subadmin.service';
import { AdminGuard } from './admin.guard';

@Controller('admin/subadmins')
@UseGuards(AdminGuard)
export class SubAdminController {
  constructor(private readonly subAdminService: SubAdminService) {}

  @Get()
  async getSubAdmins(@Req() req: any) {
    if (req.user?.role !== 'superadmin') {
      throw new UnauthorizedException('superadmin 권한이 필요합니다.');
    }
    return this.subAdminService.getSubAdmins();
  }

  @Post()
  async createSubAdmin(
    @Req() req: any,
    @Body() body: { username: string; password?: string }
  ) {
    if (req.user?.role !== 'superadmin') {
      throw new UnauthorizedException('superadmin 권한이 필요합니다.');
    }
    const { username, password } = body;
    if (!username || !password) {
      throw new UnauthorizedException('아이디와 비밀번호를 입력해주세요.');
    }
    return this.subAdminService.createSubAdmin(username, password);
  }

  @Delete(':id')
  async deleteSubAdmin(@Req() req: any, @Param('id') id: string) {
    if (req.user?.role !== 'superadmin') {
      throw new UnauthorizedException('superadmin 권한이 필요합니다.');
    }
    return this.subAdminService.deleteSubAdmin(id);
  }
}
