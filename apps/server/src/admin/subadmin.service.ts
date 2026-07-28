import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class SubAdminService {
  private readonly supabase: SupabaseClient;
  private readonly logger = new Logger(SubAdminService.name);

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration is missing for SubAdminService');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
  }

  async verifySubAdmin(username: string, password: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('sub_admins')
      .select('password_hash')
      .eq('username', username)
      .single();

    if (error || !data) {
      return false;
    }

    return bcrypt.compare(password, data.password_hash);
  }

  async createSubAdmin(username: string, password: string) {
    // Check if user already exists
    const { count } = await this.supabase
      .from('sub_admins')
      .select('*', { count: 'exact', head: true })
      .eq('username', username);

    if (count && count > 0) {
      throw new BadRequestException('이미 존재하는 아이디입니다.');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const { data, error } = await this.supabase
      .from('sub_admins')
      .insert({ username, password_hash: passwordHash })
      .select('id, username, created_at')
      .single();

    if (error) {
      this.logger.error(`Failed to create sub-admin: ${error.message}`);
      throw new BadRequestException('서브어드민 생성에 실패했습니다.');
    }

    return data;
  }

  async getSubAdmins() {
    const { data, error } = await this.supabase
      .from('sub_admins')
      .select('id, username, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to get sub-admins: ${error.message}`);
      throw new BadRequestException('목록 조회에 실패했습니다.');
    }

    return data;
  }

  async deleteSubAdmin(id: string) {
    const { error } = await this.supabase
      .from('sub_admins')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Failed to delete sub-admin: ${error.message}`);
      throw new BadRequestException('삭제에 실패했습니다.');
    }

    return { success: true };
  }
}
